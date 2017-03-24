var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var expressWinston = require('express-winston');
var winston = require('winston');
var args = require('./args');
var fs = require('fs');
var app = express();



// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


// express-winston logger makes sense BEFORE the router.
app.use(expressWinston.logger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true,
            level: args.logLevel
        }),
        new (winston.transports.File)({
            filename: args.logPath + "/rest_app.log",
            colorize: true,
            level : args.logLevel
        })
    ],
    exitOnError: false,
    colorize: true,
    requestWhitelist: ["url", "method", "originalURL"]
}));



// Routes
app.use('/', require('./routes/index'));
app.use('/api/user', require('./routes/api/jawbone/user'));
app.use('/api/body', require('./routes/api/jawbone/body'));
app.use('/api/moves', require('./routes/api/jawbone/moves'));
app.use('/api/heartrate', require('./routes/api/jawbone/heartrate'));
app.use('/api/settings', require('./routes/api/jawbone/settings'));
app.use('/api/mood', require('./routes/api/jawbone/mood'));
app.use('/api/sleeps', require('./routes/api/jawbone/sleeps'));
app.use('/api/workouts', require('./routes/api/jawbone/workouts'));
app.use('/api/telegram', require('./routes/api/telegram/telegram'));
app.use('/api/telegram/sleeps', require('./routes/api/telegram/telegram_sleeps'));
app.use('/api/telegram/moves', require('./routes/api/telegram/telegram_moves'));
app.use('/api/telegram/workouts', require('./routes/api/telegram/telegram_workouts'));
app.use('/api/weather', require('./routes/api/weather/weather'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// express-winston errorLogger makes sense AFTER the router.
app.use(expressWinston.errorLogger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true,
            level : args.logLevel
        }),
        new (winston.transports.File)({
            filename: args.logPath + "/rest_app.log",
            colorize: true,
            level : args.logLevel
        })
    ],
    exitOnError: false
}));

module.exports = app;
