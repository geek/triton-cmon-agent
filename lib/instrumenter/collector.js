/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

'use strict';

var mod_assert = require('assert-plus');
var mod_kstat = require('kstat');
var mod_vasync = require('vasync');

var lib_cache = require('../cache');
var lib_vm = require('./vm');

var KSTAT_PREFIX = 'kstat::';
var ZFS_PREFIX = 'zfs::';
var KSTAT_TTL = 10;
var ZFS_TTL = 300;

function Metrics(opts) {
    this.zones = {};
    this.cache = new lib_cache(opts);
    var reader = new mod_kstat.Reader({ 'class': 'task_caps', module: 'caps' });
    var kstatData = reader.read();
    for (var i = 0; i < kstatData.length; i++) {
        var vm_uuid = kstatData[i].data.zonename;
        this.zones[vm_uuid] =
        {
            instance: kstatData[i].instance,
            metrics: new lib_vm(vm_uuid, kstatData[i].instance)
        };
    }
}

function _kstatsToStr(kstats, cb) {
    var strKstats = '';
    var kkeys = Object.keys(kstats);
    for (var i = 0; i < kkeys.length; i++) {
        var kstatKey = [kkeys[i]];
        var kstat = kstats[kstatKey];
        strKstats += '# HELP ' + kstat.key + ' ' + kstat.help + '\n';
        strKstats += '# TYPE ' + kstat.key + ' ' + kstat.type + '\n';
        if (kstat.value || kstat.value === 0) {
            var modifier = kstat.modifier;
            var kVal = modifier ? modifier(kstat.value) : kstat.value;
            strKstats += kstat.key + ' ' + kVal + '\n';
        }
    }
    cb(null, strKstats);
}


function _zfsToStr(zmetrics, cb) {
    var strZfs = '';
    var zkeys = Object.keys(zmetrics);
    for (var j = 0; j < zkeys.length; j++) {
        var zmetricKey = [zkeys[j]];
        var zmetric = zmetrics[zmetricKey];
        strZfs += '# HELP ' + zmetric.key + ' ' + zmetric.help + '\n';
        strZfs += '# TYPE ' + zmetric.key + ' ' + zmetric.type + '\n';
        if (zmetric.value || zmetric.value === 0) {
            strZfs += zmetric.key + ' ' + zmetric.value + '\n';
        }
    }
    cb(null, strZfs);
}

Metrics.prototype.getMetrics = function (vm_uuid, cb) {
    var self = this;
    mod_assert.uuid(vm_uuid);
    mod_assert.object(this.zones[vm_uuid]);
    var zone = this.zones[vm_uuid];

    mod_vasync.pipeline({
        arg: { strMetrics: '' },
        funcs: [
            function _fetchKstats(arg, next) {
                // Build up string for kstat metrics
                var kstatCacheKey = KSTAT_PREFIX + vm_uuid;
                self.cache.get(kstatCacheKey, function (kcErr, cacheItem) {
                    if (!kcErr) {
                        _kstatsToStr(cacheItem, function (itemErr, cacheStr) {
                            mod_assert.ifError(itemErr);
                            arg.strMetrics += cacheStr;
                        });
                    } else {
                        zone.metrics.getKstats(function (kErr, kstats) {
                            mod_assert.ifError(kErr);
                            self.cache.insert(kstatCacheKey, kstats, KSTAT_TTL);
                            _kstatsToStr(kstats, function (kStrErr, kstatStr) {
                                mod_assert.ifError(kStrErr);
                                arg.strMetrics += kstatStr;
                            });
                        });
                    }
                });
                next();
            },
            function _fetchZfs(arg, next) {
                // Add zfs metrics to string
                var zfsCacheKey = ZFS_PREFIX + vm_uuid;
                self.cache.get(zfsCacheKey, function (zcErr, cacheItem) {
                    if (!zcErr) {
                        _zfsToStr(cacheItem, function (itemErr, cacheStr) {
                            mod_assert.ifError(itemErr);
                            arg.strMetrics += cacheStr;
                        });
                    } else {
                        zone.metrics.getZfsStats(function (zErr, zfs) {
                            mod_assert.ifError(zErr);
                            self.cache.insert(zfsCacheKey, zfs, ZFS_TTL);
                            _zfsToStr(zfs, function (zStrErr, zStr) {
                                mod_assert.ifError(zStrErr);
                                arg.strMetrics += zStr;
                            });
                        });
                    }
                });
                cb(null, arg.strMetrics);
                next();
            }
        ]
    },
    function (err) {
        mod_assert.ifError(err, 'Metrics could not be fetched');
    });
};

module.exports = Metrics;
