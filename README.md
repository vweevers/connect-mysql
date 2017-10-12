# connect-mysql-session-store

**MySQL session store for `express-session`. A fork of `connect-mysql` due to time pressure. Simpler and more opinionated than `connect-mysql`:**

- Pooling is on by default, no opt-out. Also refactored the code to prevent a deadlock (where connections weren't released, and new ones got queued indefinitely). We simply use the `pool.query` function built into `mysql`, which does the acquire/release process for us.
- Remove use of MySQL events and `SET GLOBAL` (which requires the `SUPER` privilege). Cleanup is instead scheduled with a JS timer.
- No keepalive by pinging. If there aren't enough queries to keep the pool alive, just let it die.
- Remove autocreation of MySQL table, to avoid the privilege. You must run [`create-table.sql`](./create-table.sql) manually or externally.

*Some of the documentation below may be outdated.*

## Options

* `table`: the name of the database table that should be used for storing sessions. Defaults to `'sessions'`
* `config`: the configuration that will be passed to `mysql.createPool()`
* `retries`: how many times to retry connecting to the database before failing.  Defaults to `3`
* `cleanup`: a boolean specifying whether to enable the cleanup events. note that if this is disabled, cleanup will not take place at all and should be done externally.  Sessions with an expiration time of `0` will always be ignored and should also be cleaned up externally.
* `secret`: key that will be used to encrypt session data.  If this option is not provided then data will be stored in plain text
* `algorithm`: the algorithm that should be used to encrypt session data.  Defaults to `'aes-256-ctr'`

## Examples
Here are some example use cases to get your application up and running.

### Default use case
Simple use case using the `express` framework & `connect-session` middleware with `connect-mysql` as the data store.

```javascript
var express = require('express'),
    session = require('connect-session'),
    MySQLStore = require('connect-mysql')(session),
    options = {
      config: {
        user: 'dbuser',
        password: 'dbpassword',
        database: 'db'
      }
    };

var app = express.createServer();

app.use(express.cookieParser());
app.use(express.session({
  secret: 'supersecretkeygoeshere',
  store: new MySQLStore(options))
});
```

### Session encryption example
This option enables transparent session encryption assisting

```javascript
var options = {
      secret: 'thesessionsecret',
      config: {
        user: 'dbuser',
        password: 'dbpassword',
        database: 'db'
      }
   };
```

## license ##

This software is licensed under the [MIT License](https://github.com/nlf/connect-mysql/blob/master/LICENSE).

Nathan LaFreniere, Copyright (c) 2012 &Yet
