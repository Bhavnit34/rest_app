var winston = require('winston');
var fs = require('fs');
// set up logger
var logPath = __dirname + "/../logs/";
// create the log directory if it doesn't exist
if (!fs.existsSync(logPath)){
    fs.mkdirSync(logPath);
}

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            "timestamp":true,
            "colorize": true
        }),
        new (winston.transports.File)({
            filename: logPath + "/rest_app.log"
        })
    ]
});

module.exports = {
    getLogger : function() { return logger;}
};