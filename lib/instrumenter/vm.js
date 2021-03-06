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

var forkExecWait = require('forkexec').forkExecWait;

// derived from sys/param.h
var FSCALE = 256;

function inskMemLimit(kstat) {
    if (kstat === Math.pow(2, 64) || kstat === 0) {
        return undefined;
    }

    return kstat;
}

function Vm(vm_uuid, instance, reader) {
    var self = this;
    self._uuid = vm_uuid;
    self._instance = instance;
    self._reader = reader;
    self._kstatMetrics = { link: {}, memory_caps: {}, zones: {} };
    self._kstatMetrics.zones.cpuUserUsage =
    {
        module: 'zones',
        kstat_key: 'nsec_user',
        key: 'cpu_user_usage',
        type: 'counter',
        help: 'User CPU utilization in nanoseconds'
    };
    self._kstatMetrics.zones.cpuSysUsage =
    {
        module: 'zones',
        kstat_key: 'nsec_sys',
        key: 'cpu_sys_usage',
        type: 'counter',
        help: 'System CPU usage in nanoseconds'
    };
    self._kstatMetrics.zones.cpuWaitTime =
    {
        module: 'zones',
        kstat_key: 'nsec_waitrq',
        key: 'cpu_wait_time',
        type: 'counter',
        help: 'CPU wait time in nanoseconds'
    };
    self._kstatMetrics.zones.loadAvg =
    {
        module: 'zones',
        kstat_key: 'avenrun_1min',
        key: 'load_average',
        type: 'gauge',
        help: 'Load average',
        modifier: function _calculateLoadAvg(kstat) { return kstat / FSCALE; }
    };
    self._kstatMetrics.memory_caps.memAggUsage =
    {
        module: 'memory_cap',
        kstat_key: 'rss',
        key: 'mem_agg_usage',
        type: 'gauge',
        help: 'Aggregate memory usage in bytes'
    };
    self._kstatMetrics.memory_caps.memLimit =
    {
        module: 'memory_cap',
        kstat_key: 'physcap',
        key: 'mem_limit',
        type: 'gauge',
        help: 'Memory limit in bytes',
        modifier: inskMemLimit
    };
    self._kstatMetrics.memory_caps.memSwap =
    {
        module: 'memory_cap',
        kstat_key: 'swap',
        key: 'mem_swap',
        type: 'gauge',
        help: 'Swap in bytes'
    };
    self._kstatMetrics.memory_caps.memSwapLimit =
    {
        module: 'memory_cap',
        kstat_key: 'swapcap',
        key: 'mem_swap_limit',
        type: 'gauge',
        help: 'Swap limit in bytes',
        modifier: inskMemLimit
    };
    self._kstatMetrics.link.netAggPacketsIn =
    {
        module: 'link',
        kstat_key: 'ipackets64',
        key: 'net_agg_packets_in',
        type: 'counter',
        help: 'Aggregate inbound packets'
    };
    self._kstatMetrics.link.netAggPacketsOut =
    {
        module: 'link',
        kstat_key: 'opackets64',
        key: 'net_agg_packets_out',
        type: 'counter',
        help: 'Aggregate outbound packets'
    };
    self._kstatMetrics.link.netAggBytesIn =
    {
        module: 'link',
        kstat_key: 'rbytes64',
        key: 'net_agg_bytes_in',
        type: 'counter',
        help: 'Aggregate inbound bytes'
    };
    self._kstatMetrics.link.netAggBytesOut =
    {
        module: 'link',
        kstat_key: 'obytes64',
        key: 'net_agg_bytes_out',
        type: 'counter',
        help: 'Aggregate outbound bytes'
    };

    self._zfsMetrics = {};
    self._zfsMetrics.zfsUsed =
    {
        zfs_key: 'used',
        key: 'zfs_used',
        type: 'gauge',
        help: 'zfs space used in bytes'
    };
    self._zfsMetrics.zfsAvailable =
    {
        zfs_key: 'available',
        key: 'zfs_available',
        type: 'gauge',
        help: 'zfs space available in bytes'
    };

    self._timeMetrics = {};
    self._timeMetrics.now =
    {
        date_key: 'now',
        key: 'time_of_day',
        type: 'counter',
        help: 'System time in seconds since epoch'
    };

    self._linkReadOpts =
    {
        'class': 'net',
        module: 'link'
    };

    self._memReadOpts =
    {
        'class': 'zone_memory_cap',
        module: 'memory_cap',
        instance: self._instance
    };

    self._zone_miscReadOpts =
    {
        'class': 'zone_misc',
        module: 'zones',
        instance: self._instance
    };
}

function _mapKstats(kstatMetrics, readerData, cb) {
    mod_assert.object(kstatMetrics, 'kstatMetrics');
    mod_assert.object(readerData, 'readerData');

    var mKeys = Object.keys(kstatMetrics);
    for (var i = 0; i < mKeys.length; i++) {
        var metric = kstatMetrics[mKeys[i]];
        if (metric && metric.module) {
            var kstatValue = readerData[metric.kstat_key];
            metric.value = kstatValue;
        } else {
            cb(new Error('Error retrieving kstat value'));
            return;
        }
    }
    cb(null, kstatMetrics);
}

Vm.prototype.getLinkKstats = function getLinkKstats(cb) {
    var self = this;
    var links = self._reader.read(self._linkReadOpts);
    var linkKeys = Object.keys(self._kstatMetrics.link);
    var link;
    for (var i = 0; i < links.length; i++) {
        if (links[i].data['zonename'] === self._uuid) {
            if (link) {
                linkKeys.forEach(function _keyMap(k) {
                    var prop = self._kstatMetrics.link[k];
                    link[prop.kstat_key] += links[i].data[prop.kstat_key];
                });
            } else {
                link = {};
                linkKeys.forEach(function _keyMap(k) {
                    var prop = self._kstatMetrics.link[k];
                    link[prop.kstat_key] = links[i].data[prop.kstat_key];
                });
            }
        }
    }

    _mapKstats(self._kstatMetrics.link, link, cb);
};

Vm.prototype.getMemCapsKstats = function getMemCapKstats(cb) {
    var self = this;
    var memCaps = self._reader.read(self._memReadOpts)[0];
    _mapKstats(self._kstatMetrics.memory_caps, memCaps.data, cb);
};

Vm.prototype.getZonesKstats = function getZonesKstats(cb) {
    var self = this;
    var zones = self._reader.read(self._zone_miscReadOpts)[0];
    _mapKstats(self._kstatMetrics.zones, zones.data, cb);
};

Vm.prototype.getZfsStats = function getZfsStats(cb) {
    var self = this;
    var zfsName = 'zones/' + self._uuid;
    forkExecWait({
        'argv': ['/usr/sbin/zfs', 'list', '-Hp', zfsName]
    }, function _processZfsOutput(err, data) {
        if (err) {
            cb(err, null);
            return;
        }

        var z = data.stdout.split('\t');
        self._zfsMetrics.zfsUsed.value = z[1];
        self._zfsMetrics.zfsAvailable.value = z[2];
        cb(null, self._zfsMetrics);
        return;
    });
};

Vm.prototype.getTimeStats = function getTimeStats(cb) {
    var self = this;
    self._timeMetrics.now.value = Date.now();
    cb(null, self._timeMetrics);
};

module.exports = Vm;
