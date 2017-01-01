// Module to construct a winston logger for any module that requires it.
var winston = require('winston');
var fs = require('fs');
var args = require('../args');

var winstonLogger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            "timestamp":true,
            "colorize": true,
            "level" : args.logLevel
        }),
        new (winston.transports.File)({
            filename: args.logPath + "/rest_app.log",
            level : args.logLevel
        })
    ],
    exitOnError: false
});

module.exports = {
    getLogger : function() { return winstonLogger;}
};