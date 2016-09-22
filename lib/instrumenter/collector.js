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

var vm = require('./vm');

function Metrics() {
    this.zones = {};
    var reader = new mod_kstat.Reader({ 'class': 'task_caps', module: 'caps' });
    var kstatData = reader.read();
    for (var i = 0; i < kstatData.length; i++) {
        var vm_uuid = kstatData[i].data.zonename;
        this.zones[vm_uuid] =
        {
            instance: kstatData[i].instance,
            metrics: new vm(vm_uuid, kstatData[i].instance)
        };
    }
}

Metrics.prototype.getMetrics = function (vm_uuid, cb) {
    mod_assert.uuid(vm_uuid);
    mod_assert.object(this.zones[vm_uuid]);
    var zone = this.zones[vm_uuid];

    // Build up string for kstat metrics
    var strMetrics = '';
    zone.metrics.getKstats(function (err, kmetrics) {
        mod_assert.ifError(err);
        var kkeys = Object.keys(kmetrics);
        for (var i = 0; i < kkeys.length; i++) {
            var kmetricKey = [kkeys[i]];
            var kmetric = kmetrics[kmetricKey];
            strMetrics += '# HELP ' + kmetric.key + ' ' + kmetric.help + '\n';
            strMetrics += '# TYPE ' + kmetric.key + ' ' + kmetric.type + '\n';
            if (kmetric.value) {
                strMetrics += kmetric.key + ' ' + kmetric.value + '\n';
            }
        }
    });

    // Add zfs metrics to string
    zone.metrics.getZfsStats(function _zfsToStr(err, zmetrics) {
        mod_assert.ifError(err);
        var zkeys = Object.keys(zmetrics);
        for (var j = 0; j < zkeys.length; j++) {
            var zmetricKey = [zkeys[j]];
            var zmetric = zmetrics[zmetricKey];
            strMetrics += '# HELP ' + zmetric.key + ' ' + zmetric.help + '\n';
            strMetrics += '# TYPE ' + zmetric.key + ' ' + zmetric.type + '\n';
            if (zmetric.value) {
                strMetrics += zmetric.key + ' ' + zmetric.value + '\n';
            }
        }

        cb(null, strMetrics);
    });
};

module.exports = Metrics;
