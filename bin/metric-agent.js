/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

'use strict';

var mod_fs = require('fs');

var Server = require('../lib/server');

var configFilename = '/opt/smartdc/agents/etc/metric-agent.config.json';

function loadConfig(filename, callback) {
    mod_fs.readFile(filename, function (error, data) {
        if (error) {
            callback(error);
            return;
        }
        callback(error, JSON.parse(data.toString()));
        return;
    });
}

loadConfig(configFilename, function (error, config) {
    if (error) {
        return;
    } else {
        var server = new Server(config);
        server.start();
    }
});
