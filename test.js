'use strict'

const test = require('tape')
const EventEmitter = require('events').EventEmitter
const proxyquire = require('proxyquire')
const noop = function() {}
const mocks = { pool: null }

const factory = proxyquire('./lib/connect-mysql', {
  mysql: {
    createPool: function (config) {
      return mocks.pool
    },
    escapeId: function (id) {
      return '`' + id + '`'
    }
  }
})

function MockPool() {
  EventEmitter.call(this)
}

MockPool.prototype.query = function (sql, values, cb) {
  if (typeof values === 'function') cb = values, values = null
  this._query(sql.trim().replace(/ +/g, ' '), values, cb)
}

require('util').inherits(MockPool, EventEmitter)

test('set and get', function (t) {
  t.plan(4)

  const pool = mocks.pool = new MockPool()
  const queryCalls = []
  const expires = future()
  const expectedSession = JSON.stringify({ cookie: { expires }})
  const expectedExpires = Math.round(expires / 1000)

  let storedSession = null

  pool._query = function (sql, values, cb) {
    queryCalls.push({ sql, values })

    if (/^INSERT/.test(sql)) {
      storedSession = values[1]
      process.nextTick(cb)
    } else if (/^SELECT `session`/.test(sql)) {
      process.nextTick(cb, null, [ { session: storedSession } ])
    } else {
      process.nextTick(cb)
    }
  }

  const MySQLStore = factory({ Store: noop })

  const store = new MySQLStore({
    retries: 0,
    cleanup: false,
    table : 'custom_sessions',
    config: {
      host: 'fake',
      user: 'fake',
      password: 'fake',
      database: 'fake'
    }
  })

  store.set('sid', { cookie: { expires } }, function (err) {
    t.ifError(err, 'no set error')

    store.get('sid', function (err, session) {
      t.ifError(err, 'no get error')
      t.same(session, { cookie: { expires: expires.toJSON() } })

      t.same(queryCalls, [
        {
          sql: 'INSERT INTO `custom_sessions` (`sid`, `session`, `expires`)\n '+
          'VALUES (?, ?, ?)\n ON DUPLICATE KEY UPDATE `session` = ?, `expires` = ?',
          values: [
            'sid',
            expectedSession,
            expectedExpires,
            expectedSession,
            expectedExpires
          ]
        },
        {
          sql: 'SELECT `session` FROM `custom_sessions` WHERE `sid` = ?',
          values: ['sid']
        }
      ])
    })
  })
})

test('set and get (encrypted)', function (t) {
  t.plan(5)

  const pool = mocks.pool = new MockPool()
  const queryCalls = []
  const expires = future()
  const expectedSession = JSON.stringify({ cookie: { expires }})
  const expectedExpires = Math.round(expires / 1000)

  let storedSession = null

  pool._query = function (sql, values, cb) {
    queryCalls.push({ sql, values })

    if (/^INSERT/.test(sql)) {
      storedSession = values[1]
      process.nextTick(cb)
    } else if (/^SELECT `session`/.test(sql)) {
      process.nextTick(cb, null, [ { session: storedSession } ])
    } else {
      process.nextTick(cb)
    }
  }

  const MySQLStore = factory({ Store: noop })

  const store = new MySQLStore({
    retries: 0,
    cleanup: false,
    secret: 'foo',
    config: {
      host: 'fake',
      user: 'fake',
      password: 'fake',
      database: 'fake'
    }
  })

  store.set('sid', { cookie: { expires } }, function (err) {
    t.ifError(err, 'no set error')

    store.get('sid', function (err, session) {
      t.ifError(err, 'no get error')
      t.same(session, { cookie: { expires: expires.toJSON() } })

      try {
        JSON.parse(storedSession)
      } catch (err) {
        // just a smoke test atm
        t.ok(err, 'not saved as json')
      }

      t.same(queryCalls, [
        {
          sql: 'INSERT INTO `sessions` (`sid`, `session`, `expires`)\n '+
          'VALUES (?, ?, ?)\n ON DUPLICATE KEY UPDATE `session` = ?, `expires` = ?',
          values: [
            'sid',
            storedSession,
            expectedExpires,
            storedSession,
            expectedExpires
          ]
        },
        {
          sql: 'SELECT `session` FROM `sessions` WHERE `sid` = ?',
          values: ['sid']
        }
      ])
    })
  })
})

function future () {
  const d = new Date()
  d.setHours(d.getHours() + 1)
  return d
}

function mockError (message, code, fatal) {
  const err = new Error(message)

  Object.defineProperty(err, 'code', { value: code })
  Object.defineProperty(err, 'fatal', { value: !!fatal })

  return err
}
