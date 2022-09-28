/**
 * http://usejsdoc.org/

 */
'use strict';
let wxConf = {};

//  获取token grant_type
wxConf.getTokenGrantType = "client_credential";
//  获取openid grant_type
wxConf.userInfoGrantType = "authorization_code";
//  appId

wxConf.default = {
    "nameSpace":"test"
};

wxConf.prd = {
    "appId": "wx958b15c99cf3dab5",
    "secret": "32aea6c8cc39b516f2c4bfc7a37b04fd"
};

module.exports = wxConf;