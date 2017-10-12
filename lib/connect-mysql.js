'use strict'

/*!
 * connect-mysql
 * Author: Nathan LaFreniere <nlf@andyet.net>
 */

const util = require('util');
const crypto = require('crypto');
const explain = require('explain-error');
const mysql = require('mysql');

function encryptData(plaintext, secret, algo) {
  const envelope = {
    hmac: digest(secret, plaintext),
    pt: plaintext
  };

  return encrypt(secret, JSON.stringify(envelope), algo);
}

function decryptData(ciphertext, secret, algo) {
  const pt = decrypt(secret, ciphertext, algo);
  const envelope = JSON.parse(pt);
  const hmac = digest(secret, envelope.pt);

  if (hmac !== envelope.hmac) {
    throw new Error('Encrypted session was tampered with');
  }

  return envelope.pt;
}

function digest(key, plaintext) {
  const hmac = crypto.createHmac('sha512', key);
  hmac.update(plaintext);
  return hmac.digest('hex');
}

function encrypt(key, pt, algo) {
  algo = algo || 'aes-256-ctr';
  pt = Buffer.isBuffer(pt) ? pt : Buffer.from(pt);

  const cipher = crypto.createCipher(algo, key);
  const ct = [];

  ct.push(cipher.update(pt, 'buffer', 'hex'));
  ct.push(cipher.final('hex'));

  return ct.join('');
}

function decrypt(key, ct, algo) {
  algo = algo || 'aes-256-ctr';

  const cipher = crypto.createDecipher(algo, key);
  const pt = [];

  pt.push(cipher.update(ct, 'hex', 'utf8'));
  pt.push(cipher.final('utf8'));

  return pt.join('');
}


module.exports = function(connect) {
  const Store = connect.Store || connect.session.Store;

  function MySQLStore(options) {
    if (!(this instanceof MySQLStore)) {
      return new MySQLStore(options)
    }

    Store.call(this, options);

    this.numRetries = options.retries === 0 ? 0 : options.retries || 3;
    this.enableCleanup = options.cleanup == null ? true : !!options.cleanup;
    this.secret = options.secret;
    this.algorithm = options.algorithm || 'aes-256-ctr';
    this.pool = mysql.createPool(options.config);

    const table = mysql.escapeId(options.table || 'sessions')
    const sid = mysql.escapeId('sid')
    const session = mysql.escapeId('session')
    const expires = mysql.escapeId('expires')

    this.selectStmt = `SELECT ${session} FROM ${table} WHERE ${sid} = ?`
    this.deleteStmt = `DELETE FROM ${table} WHERE ${sid} = ?`

    this.insertStmt = `
      INSERT INTO ${table} (${sid}, ${session}, ${expires})
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE ${session} = ?, ${expires} = ?`

    if (this.enableCleanup) {
      const sql = `
        DELETE FROM ${table}
        WHERE ${sid} IN (
          SELECT temp.sid FROM (
            SELECT ${sid} FROM ${table}
            WHERE ${expires} > 0 AND ${expires} < UNIX_TIMESTAMP()
          ) AS temp
        )`

      const cleanup = () => {
        this.query(sql, (err) => {
          // TODO: debug(err) or emit it?
          console.error(err)
        });
      }

      // TODO: run once on startup
      setInterval(cleanup, 900000).unref();
    }
  }

  util.inherits(MySQLStore, Store);

  MySQLStore.prototype.query = function(sql, values, callback) {
    if (typeof values === 'function') {
      callback = values
      values = null
    }

    let attempts = 0;

    const execute = () => {
      this.pool.query(sql, values, (err, result) => {
        if (err && err.fatal) {
          if (++attempts > this.numRetries) {
            return callback(explain(err, 'Too many attempts'))
          }

          return setImmediate(execute);
        } else if (err) {
          return callback(err);
        }

        callback(null, result);
      })
    }

    execute();
  };

  MySQLStore.prototype.get = function(sid, callback) {
    this.query(this.selectStmt, [sid], (err, rows) => {
      if (err) return callback(err)

      if (rows && rows.length > 0 && rows[0].session) {
        let session;
        let json = rows[0].session;

        try {
          if (this.secret) {
            json = decryptData(json, this.secret, this.algorithm);
          }

          session = JSON.parse(json)
        } catch (err2) {
          return callback(err2);
        }

        callback(null, session);
      } else {
        callback();
      }
    });
  };

  MySQLStore.prototype.set = function(sid, session, callback) {
    const expires = Math.round(new Date(session.cookie.expires).getTime() / 1000);

    session = JSON.stringify(session);

    if (this.secret) {
      session = encryptData(session, this.secret, this.algorithm);
    }

    this.query(
      this.insertStmt,
      [sid, session, expires, session, expires],
      errorOnly(callback)
    );
  };

  MySQLStore.prototype.destroy = function(sid, callback) {
    this.query(this.deleteStmt, [sid], errorOnly(callback));
  };

  return MySQLStore;
};

function errorOnly (cb) {
  return function (err) {
    cb(err)
  }
}
