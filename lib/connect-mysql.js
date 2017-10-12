'use strict'

/*!
 * connect-mysql
 * Author: Nathan LaFreniere <nlf@andyet.net>
 */

var util = require('util');
var crypto = require('crypto');
var explain = require('explain-error');
var mysql = require('mysql');
var noop = function() {};

function encryptData(plaintext, secret, algo) {
  var hmac = digest(secret, plaintext);

  var obj = {
    hmac: hmac,
    pt: plaintext
  };

  var ct = encrypt(secret, JSON.stringify(obj), algo);

  return ct;
}

function decryptData(ciphertext, secret) {
  var pt = decrypt(secret, ciphertext);
  var obj = JSON.parse(pt);
  var hmac = digest(secret, JSON.stringify(obj.pt));

  if (hmac != obj.hmac) {
    throw 'Encrypted session was tampered with!';
  }

  return obj.pt;
}

function digest(key, obj) {
  var hmac = crypto.createHmac('sha512', key);
  hmac.setEncoding('hex');
  hmac.write(obj);
  hmac.end();
  return hmac.read();
}

function encrypt(key, pt, algo) {
  algo = algo || 'aes-256-ctr';
  pt = (Buffer.isBuffer(pt)) ? pt : new Buffer(pt);

  var cipher = crypto.createCipher(algo, key);
  var ct = [];

  ct.push(cipher.update(pt, 'buffer', 'hex'));
  ct.push(cipher.final('hex'));

  return ct.join('');
}

function decrypt(key, ct, algo) {
  algo = algo || 'aes-256-ctr';
  var cipher = crypto.createDecipher(algo, key);
  var pt = [];

  pt.push(cipher.update(ct, 'hex', 'utf8'));
  pt.push(cipher.final('utf8'));

  return pt.join('');
}


module.exports = function(connect) {
  var Store = connect.Store || connect.session.Store;

  function MySQLStore(options) {
    Store.call(this, options);

    this.table = options.table || 'sessions';
    this.numRetries = options.retries === 0 ? 0 : options.retries || 3;
    this.enableCleanup = options.cleanup == null ? true : !!options.cleanup;
    this.secret = options.secret;
    this.algorithm = options.algorithm || 'aes-256-ctr';
    this.pool = mysql.createPool(options.config);

    if (this.enableCleanup) {
      const sql = 'DELETE FROM `' + this.table + '` WHERE id IN (' +
        'SELECT temp.id FROM (' +
          'SELECT `id` FROM `' + this.table + '` WHERE `expires` > 0 AND `expires` < UNIX_TIMESTAMP()' +
        ') AS temp' +
      ');'

      const cleanup = () => {
        this.query(sql, (err) => {
          // TODO: debug(err) or emit it?
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
            return callback(explain(err, 'Too many retries'))
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
    const sql = 'SELECT `session` FROM `' + this.table + '` WHERE `sid` = ?'
    const values = [sid]

    this.query(sql, values, (err, rows) => {
      if (err) return callback(err)

      if (rows && rows.length > 0 && rows[0].session) {
        try {
          // TODO: why are there two JSON.parse calls?
          const session = JSON.parse(rows[0].session);

          if (this.secret) {
            session = JSON.parse(decryptData(session, this.secret, this.algorithm));
          }

          // TODO: call outside of try/catch
          callback(null, session);
        } catch (err2) {
          callback(err2);
        }
      } else {
        callback();
      }
    });
  };

  MySQLStore.prototype.set = function(sid, session, callback) {
    const expires = new Date(session.cookie.expires).getTime() / 1000;

    session = JSON.stringify(session);

    if (this.secret) {
      session = encryptData(session, this.secret, this.algorithm);
    }

    const sql = 'INSERT INTO `' + this.table +
      '` (`sid`, `session`, `expires`) VALUES(?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE `session` = ?, `expires` = ?'

    this.query(sql, [sid, session, expires, session, expires], errorOnly(callback));
  };

  MySQLStore.prototype.destroy = function(sid, callback) {
    this.query('DELETE FROM `' + this.table + '` WHERE `sid` = ?', [sid], errorOnly(callback));
  };

  return MySQLStore;
};

function errorOnly (cb) {
  return function (err) {
    cb(err)
  }
}
