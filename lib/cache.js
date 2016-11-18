/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */
'use strict';

var mod_assert = require('assert-plus');

var MSEC_PER_SEC = 1000;
var POLL_INTERVAL_MSEC = 300000;

function Cache(opts) {
    var self = this;
    self._items = {};
    self._expiresKeys = {};
    self._log = opts.log;
    setInterval(function _sweep() {
        var bucketKeys = Object.keys(self._expiresKeys);
        var bucketKeyCount = bucketKeys.length;
        if (bucketKeyCount > 0) {
            for (var i = 0; i < bucketKeyCount; i++) {
                var bucket = self._expiresKeys[bucketKeys[i]];
                for (var j = 0; j < bucket.length; j++) {
                    var item = self._items[bucket[j]];
                    if (item && (_calculateExpiration(item) <= Date.now())) {
                        delete self._items[bucket[j]];
                    } else {
                        break;
                    }
                }
            }
        }
    }, POLL_INTERVAL_MSEC).unref();
}

function _calculateExpiration(item) {
    mod_assert.object(item);
    return item.date + item.TTL;
}

Cache.prototype.get = function _get(key, cb) {
    var self = this;
    var err;
    var result;

    mod_assert.string(key, 'key');
    var item = self._items[key];
    if (item) {
        var expired = _calculateExpiration(item) <= Date.now();
        if (expired) {
            err = new Error('Not found');
            err.code = 'ENOTFOUND';
            delete self._items[key];
        } else {
            result = self._items[key].value;
        }
    } else {
        err = new Error('Not found');
        err.code = 'ENOTFOUND';
    }

    cb(err, result);
};

Cache.prototype.insert = function _insert(key, value, TTL) {
    var self = this;
    mod_assert.string(key, 'key');
    mod_assert.ok(value, 'value');
    mod_assert.number(TTL, 'TTL must be a number');
    // TODO: Uncomment when this can be run in node v4.x
    // mod_assert.ok(Number.isInteger(TTL), 'TTL must be an integer');
    mod_assert.ok(TTL > 0, 'TTL must be positive');
    var msecTTL = TTL * MSEC_PER_SEC;
    self._items[key] = {
        value: value,
        TTL: msecTTL,
        date: Date.now()
    };

    var msTTLstr = msecTTL.toString();
    self._expiresKeys[msTTLstr] = self._expiresKeys[msTTLstr] || [];
    self._expiresKeys[msTTLstr].push(key);
};

Cache.prototype.remove = function _remove(key, cb) {
    var self = this;
    var err;
    var result;

    mod_assert.string(key, 'key');
    if (self._items[key]) {
        delete self._items[key];
        result = true;
    } else {
        err = new Error('Not found');
    }

    cb(err, result);
};

module.exports = Cache;
