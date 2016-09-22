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

function apiGetMetrics(req, res, next) {
    res.header('content-type', 'text/plain');
    req.app.collector.getMetrics(req.params.container,
        function (err, strMetrics) {
            if (!err) {
                res.send(strMetrics);
            }
    });
    next();
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get(
        {
            name: 'GetMetricsForContainer',
            path: '/:container/metrics'
        }, apiGetMetrics);
}

module.exports = {
    mount: mount
};
