// Module to construct a winston logger for any module that requires it.
var winston = require('winston');
var fs = require('fs');
// set up logger
var logPath = __dirname + "/../logs/";
// create the log directory if it doesn't exist
if (!fs.existsSync(logPath)){
    fs.mkdirSync(logPath);
}

var winstonLogger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            "timestamp":true,
            "colorize": true
        }),
        new (winston.transports.File)({
            filename: logPath + "/rest_app.log"
        })
    ],
    exitOnError: false
});

module.exports = {
    getLogger : function() { return winstonLogger;}
};