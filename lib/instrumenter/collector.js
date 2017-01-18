/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

'use strict';

var mod_assert = require('assert-plus');
var mod_kstat = require('kstat');
var mod_vasync = require('vasync');

var lib_cache = require('../cache');
var lib_vm = require('./vm');

var sprintf = require('sprintf-js').sprintf;

var KSTAT_PREFIX = 'kstat::';
var ZFS_PREFIX = 'zfs::';
var KSTAT_TTL = 10;
var ZFS_TTL = 300;

var META_FMT = '# HELP %s %s\n# TYPE %s %s\n';
var METRIC_FMT = '%s %s\n';

function Metrics(opts) {
    var self = this;
    self.zones = {};
    self.cache = new lib_cache(opts);
    self.reader = new mod_kstat.Reader();
    self.refreshZoneCache(function _mrfz(err) {
        mod_assert.ifError(err, 'refreshZones error');
    });
}

function _kstatsToStr(kstats, cb) {
    var strKstats = '';
    var kkeys = Object.keys(kstats);
    for (var i = 0; i < kkeys.length; i++) {
        var kstatKey = [kkeys[i]];
        var kstat = kstats[kstatKey];
        strKstats += sprintf(
                META_FMT,
                kstat.key,
                kstat.help,
                kstat.key,
                kstat.type);
        if (kstat.value || kstat.value === 0) {
            var modifier = kstat.modifier;
            var kVal = modifier ? modifier(kstat.value) : kstat.value;
            strKstats += sprintf(METRIC_FMT, kstat.key, kVal);
        }
    }
    cb(null, strKstats);
}

function _refreshZones(reader, cb) {
    // This is a bit of a hack, but it appears to be the most reliable way to
    // map available vm_uuids to kstat instance ids. The class 'task_caps' and
    // module 'caps' were chosen because they result in all vm_uuids being
    // returned.
    var kstatOpts = { 'class': 'task_caps', module: 'caps' };
    var kstatData = reader.read(kstatOpts);
    var zones = {};
    mod_vasync.forEachPipeline({
        'inputs': kstatData,
        'func': function _rfz(kstatItem, next) {
            var vm_uuid = kstatItem.data.zonename;
            zones[vm_uuid] =
            {
                instance: kstatItem.instance,
                metrics: new lib_vm(vm_uuid, kstatItem.instance, reader)
            };
            next();
        }
    }, function (err, results) {
        cb(err, zones);
    });
}

function _timeToStr(tmetrics, cb) {
    var strTime = '';
    var tkeys = Object.keys(tmetrics);
    for (var i = 0; i < tkeys.length; i++) {
        var tmetricKey = [tkeys[i]];
        var tmetric = tmetrics[tmetricKey];
        strTime += sprintf(
                META_FMT,
                tmetric.key,
                tmetric.help,
                tmetric.key,
                tmetric.type);
        strTime += sprintf(METRIC_FMT, tmetric.key, tmetric.value);
    }
    cb(null, strTime);
}

function _zfsToStr(zmetrics, cb) {
    var strZfs = '';
    var zkeys = Object.keys(zmetrics);
    for (var i = 0; i < zkeys.length; i++) {
        var zmetricKey = [zkeys[i]];
        var zmetric = zmetrics[zmetricKey];
        strZfs += sprintf(
                META_FMT,
                zmetric.key,
                zmetric.help,
                zmetric.key,
                zmetric.type);
        if (zmetric.value || zmetric.value === 0) {
            strZfs += sprintf(METRIC_FMT, zmetric.key, zmetric.value);
        }
    }
    cb(null, strZfs);
}

Metrics.prototype.getMetrics = function getMetrics(vm_uuid, cb) {
    var self = this;
    mod_assert.uuid(vm_uuid);
    mod_assert.object(this.zones[vm_uuid]);
    var zone = this.zones[vm_uuid];
    var vmMetrics = { strMetrics: '' };

    mod_vasync.pipeline({
        arg: vmMetrics,
        funcs: [
            function _fetchKstats(arg, next) {
                // Build up string for kstat metrics
                var kstatCacheKey = KSTAT_PREFIX + vm_uuid;
                self.cache.get(kstatCacheKey, function (kcErr, cacheItem) {
                    if (!kcErr) {
                        _kstatsToStr(cacheItem, function (itemErr, cacheStr) {
                            mod_assert.ifError(itemErr);
                            arg.strMetrics += cacheStr;
                            next();
                        });
                    } else {
                        zone.metrics.getKstats(function (kErr, kstats) {
                            mod_assert.ifError(kErr);
                            self.cache.insert(kstatCacheKey, kstats, KSTAT_TTL);
                            _kstatsToStr(kstats, function (kStrErr, kstatStr) {
                                mod_assert.ifError(kStrErr);
                                arg.strMetrics += kstatStr;
                                next();
                            });
                        });
                    }
                });
            },
            function _fetchZfs(arg, next) {
                // Add zfs metrics to string
                var zfsCacheKey = ZFS_PREFIX + vm_uuid;
                self.cache.get(zfsCacheKey, function (zcErr, cacheItem) {
                    if (!zcErr) {
                        _zfsToStr(cacheItem, function (itemErr, cacheStr) {
                            mod_assert.ifError(itemErr);
                            arg.strMetrics += cacheStr;
                            next();
                        });
                    } else {
                        zone.metrics.getZfsStats(function (zErr, zfs) {
                            mod_assert.ifError(zErr);
                            self.cache.insert(zfsCacheKey, zfs, ZFS_TTL);
                            _zfsToStr(zfs, function (zStrErr, zStr) {
                                mod_assert.ifError(zStrErr);
                                arg.strMetrics += zStr;
                                next();
                            });
                        });
                    }
                });
            },
            function _fetchTime(arg, next) {
                zone.metrics.getTimeStats(function (tErr, timeStats) {
                    mod_assert.ifError(tErr);
                    _timeToStr(timeStats, function (tStrErr, tStr) {
                        mod_assert.ifError(tStrErr);
                        arg.strMetrics += tStr;
                        next();
                    });
                });
            }
        ]
    },
    function (err) {
        mod_assert.ifError(err, 'Metrics could not be fetched');
        cb(null, vmMetrics.strMetrics);
    });
};

Metrics.prototype.refreshZoneCache = function refreshZones(cb) {
    var self = this;
    _refreshZones(self.reader, function _mrfz(err, zones) {
        mod_assert.ifError(err, '_refreshZones error');
        mod_assert.object(zones, 'zones');
        self.zones = zones;
        cb(err);
    });
};

module.exports = Metrics;
