// Module to handle command line args
var fs = require('fs');
var myArgs = require('optimist').argv,
    help = 'This would be a great place for real help information.';


if ((myArgs.h)||(myArgs.help)) {
    console.log(help);
    process.exit(0);
}
var logPath = __dirname + "/logs/";
if (myArgs.logPath) {
    logPath = myArgs.logPath;
}
// create the log directory if it doesn't exist
if (!fs.existsSync(logPath)){
    fs.mkdirSync(logPath);
}
var logLevel = "info";
if (myArgs.logLevel) {
    logLevel = myArgs.logLevel;
}

// export necessary variables
exports.logPath = logPath;
exports.logLevel = logLevel;