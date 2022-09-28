let express = require('express');
let path = require('path');
let bodyParser = require('body-parser');


const index = require('./routes/index');

let startPort = require('./config/startPort');

let log4js = require('log4js');
log4js.configure('./config/log4js.json');
let loggerInfo = log4js.getLogger("default");
let loggerError = log4js.getLogger("error");
loggerInfo.level = 'debug';
loggerInfo.debug("Some debug messages");
let session = require('express-session');
let cookieParser = require('cookie-parser');

let app = express();

app.set('views', path.join(__dirname, 'views'));
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

// uncomment after placing your favicon in /public
app.use(cookieParser('cookieKg'));
app.use(session({
  secret: 'cookieKg',//与cookieParser中的一致
  name: 'cookieKg',
  resave: true,
  cookie: {
    maxAge: 1000 * 60 * 60 *24* 30 // 设置session过期时间
  },
  saveUninitialized: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

//传递 根 和url
app.use(function (req, res, next) {
  res.locals.localurl = req.protocol + "://" + req.headers.host;
  res.locals.projectUrl = startPort.projectUrl;
  next();
});

let options = {
  dotfiles: 'ignore',
  etag: true,
  extensions: ['css', 'js', 'png', 'jpg', 'jpeg', 'woff', 'gif'],
  maxage: 1000 * 60 * 60 * 24,
  setHeaders: function (res, path, stat) {
  }
};

app.use(startPort.projectUrl, express.static(path.join(__dirname, 'public'), options));

app.use(startPort.projectUrl, index);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  loggerError.error(req.method);
  loggerError.error(req.url);
  let err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  loggerError.error(res.locals);
  // render the error page
  res.status(err.status || 500);
  if (err.status == 404) {
    res.render('errorCenter', {"msg": "抱歉，页面找不到了"});
  } else {
    res.render('errorCenter');
  }
});

module.exports = app;
