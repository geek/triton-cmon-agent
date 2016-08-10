/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */
'use strict';

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');

var metrics = require('./metrics');

var EXPORTER_PORT = 9163;

function Server(config) {
    var self = this;
    self.config = config;
    self.log = new mod_bunyan({
        name: 'Metric Agent',
        level: config.logLevel,
        serializers: {
            err: mod_bunyan.stdSerializers.err,
            req: mod_bunyan.stdSerializers.req,
            res: mod_bunyan.stdSerializers.res
        }
    });

    self.log.info({ config: config }, 'Metric Agent config');
    self.config.log = self.log;
    self.metrics = new metrics();
}

Server.prototype.start = function start() {
    var self = this;

    var magent = mod_restify.createServer({
        name: 'Metric Agent',
        log: self.log,
        handleUpgrades: false
    });

    magent.listen(EXPORTER_PORT, function () {
        self.log.info('% listening at %s', magent.name, magent.url);
    });

    magent.get({
        name: 'metrics',
        path: '/:vm/metrics'
    }, function _metrics(req, res, next) {
        res.header('content-type', 'text/plain');
        self.metrics.getMetrics(req.params.vm, function (err, strMetrics) {
            if (!err) {
                res.send(strMetrics);
            }
        });

        return next();
    });

    magent.get({
        name: 'metrics-hack',
        path: '/metrics'
    }, function _metrics(req, res, next) {
        res.header('content-type', 'text/plain');
        var splitHost = req.headers.host.split('.');
        self.metrics.getMetrics(splitHost[0], function (err, strMetrics) {
            if (!err) {
                res.send(strMetrics);
            }
        });

        return next();
    });
};

module.exports = Server;
