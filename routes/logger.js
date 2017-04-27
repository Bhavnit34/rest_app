// Module to construct a winston logger for any module that requires it.
var winston = require('winston');
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
            colorize: true,
            level : args.logLevel,
            json : false
        })
    ],
    exitOnError: false
});

// allows the function to be called from other modules
module.exports = {
    getLogger : function() { return winstonLogger;}
};