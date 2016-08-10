/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */
'use strict';
var mod_kstat = require('kstat');
var spawn = require('child_process').spawn;

function Vm(vm_uuid, instance) {
    var self = this;
    self._uuid = vm_uuid;
    self._instance = instance;
    self._kstatMetrics = {};
    self._kstatMetrics.cpuAggUsage =
    {
        module: 'zones',
        kstat_key: 'nsec_user',
        key: 'cpu_agg_usage',
        type: 'gauge',
        help: 'Aggregate CPU usage'
    };
    self._kstatMetrics.cpuWaitTime =
    {
        module: 'zones',
        kstat_key: 'nsec_user',
        key: 'cpu_wait_time',
        type: 'gauge',
        help: 'CPU wait time'
    };
    self._kstatMetrics.loadAvg =
    {
        module: 'zones',
        kstat_key: 'avenrun_1min',
        key: 'load_average',
        type: 'gauge',
        help: 'Load average'
    };
    self._kstatMetrics.memAggUsage =
    {
        module: 'memory_cap',
        kstat_key: 'rss',
        key: 'mem_agg_usage',
        type: 'gauge',
        help: 'Aggregate memory usage'
    };
    self._kstatMetrics.memLimit =
    {
        module: 'memory_cap',
        kstat_key: 'physcap',
        key: 'mem_limit',
        type: 'gauge',
        help: 'Memory limit'
    };
    self._kstatMetrics.memSwap =
    {
        module: 'memory_cap',
        kstat_key: 'swap',
        key: 'mem_swap',
        type: 'gauge',
        help: 'Swap'
    };
    self._kstatMetrics.memSwapLimit =
    {
        module: 'memory_cap',
        kstat_key: 'swapcap',
        key: 'mem_swap_limit',
        type: 'gauge',
        help: 'Swap limit'
    };
    self._kstatMetrics.netAggPacketsIn =
    {
        module: 'link',
        kstat_key: 'ipackets64',
        key: 'net_agg_packets_in',
        type: 'gauge',
        help: 'Aggregate inbound packets'
    };
    self._kstatMetrics.netAggPacketsOut =
    {
        module: 'link',
        kstat_key: 'opackets64',
        key: 'net_agg_packets_out',
        type: 'gauge',
        help: 'Aggregate outbound packets'
    };
    self._kstatMetrics.netAggBytesIn =
    {
        module: 'link',
        kstat_key: 'rbytes64',
        key: 'net_agg_bytes_in',
        type: 'gauge',
        help: 'Aggregate inbound bytes'
    };
    self._kstatMetrics.netAggBytesOut =
    {
        module: 'link',
        kstat_key: 'obytes64',
        key: 'net_agg_bytes_out',
        type: 'gauge',
        help: 'Aggregate outbound bytes'
    };

    self._zfsMetrics = {};
    self._zfsMetrics.zfsUsed =
    {
        zfs_key: 'used',
        key: 'zfs_used',
        type: 'gauge',
        help: 'zfs space used'
    };
    self._zfsMetrics.zfsAvailable =
    {
        zfs_key: 'available',
        key: 'zfs_available',
        type: 'gauge',
        help: 'zfs space available'
    };

    self._linkReader = new mod_kstat.Reader(
    {
        'class': 'net',
        module: 'link',
        zonename: self._uuid
    });

    self._mcReader = new mod_kstat.Reader(
    {
        'class': 'zone_memory_cap',
        module: 'memory_cap',
        instance: self._instance
    });


    self._zmReader = new mod_kstat.Reader(
    {
        'class': 'zone_misc',
        module: 'zones',
        instance: self._instance
    });
}

Vm.prototype.getKstats = function _getKstats(cb) {
    var self = this;

    var links = self._linkReader.read()[0];
    var memCaps = self._mcReader.read()[0];
    var zones = self._zmReader.read()[0];

    var kstats =
    {
        link: links,
        memory_cap: memCaps,
        zones: zones
    };

    var mKeys = Object.keys(self._kstatMetrics);
    for (var i = 0; i < mKeys.length; i++) {
        var metric = self._kstatMetrics[mKeys[i]];
        if (kstats && kstats[metric.module]) {
            metric.value = kstats[metric.module].data[metric.kstat_key];
        }
    }

    cb(null, self._kstatMetrics);
};

Vm.prototype.getZfsStats = function _getZfsStats(cb) {
    var self = this;
    var zfsName = 'zones/' + self._uuid;
    var zfsList = spawn('/usr/sbin/zfs', ['list', '-Hp', zfsName]);
    zfsList.stdout.once('data', function (data) {
        var z = data.toString().split('\t');
        self._zfsMetrics.zfsUsed.value = z[1];
        self._zfsMetrics.zfsAvailable.value = z[2];
        cb(null, self._zfsMetrics);
    });
};

module.exports = Vm;
