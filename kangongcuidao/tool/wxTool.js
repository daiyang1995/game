/**
 * http://usejsdoc.org/

 */
'use strict';
const https = require('https');
const wxConf = require("../config/wxConf");
const redisConf = require('../config/redisConf');

const crypto = require("./crypto");
const co = require('co');

const redisTool = require('./redisTool');

const log4js = require('log4js');
const loggerInfo = log4js.getLogger("default");
const loggerError = log4js.getLogger("error");

function wxTool() {};

/**
 * 获取用户信息
 * @param access_token String
 * @param openId String
 * @param callBackFunction function(res)
 */
wxTool.getUserInfo = function(access_token,openId ,res, callBackFunction){
	https.get(`https://api.weixin.qq.com/cgi-bin/user/info?access_token=${access_token}&openid=${openId}&lang=zh_CN`, callBackFunction)
		.on('error', function (e) {
			loggerError.error("发生错误:" +e);
			let json = {};
			json.msg = e;
			return res.render("pcError",json);
		});
};

/**
 * 获取用户openId
 * @param channel String
 * @param code String
 * @param callBackFunction function(res)
 */
wxTool.getUserOpenId = function (channel, code, callBackFunction) {
	if(!(channel in wxConf)){
		// channel = "default"
		channel = wxConf["default"].nameSpace;
	}
	https.get(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${wxConf[channel].appId}&secret=${wxConf[channel].secret}&code=${code}&grant_type=authorization_code`,callBackFunction);
};

/**
 * 获取accessToken
 * @param channel String
 * @param callBackFunction function(res)
 */
wxTool.getAccessToken = function (channel, callBackFunction) {
	if(!(channel in wxConf)){
		channel = wxConf["default"].nameSpace;
	}
	https.get(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${wxConf[channel].appId}&secret=${wxConf[channel].secret}`,callBackFunction);
};
/**
 * 获取jsapi_ticket
 * @param access_token
 * @param callBackFunction
 */
wxTool.getJsapiTicketo =function(access_token ,callBackFunction ){
	https.get(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${access_token}&type=jsapi`,callBackFunction);
};

/**
 * 获取微信js签名
 * @param req
 * @param jsapiTicket
 * @param shareUrl
 * @param shareTitle
 * @param shareContent
 * @param shareImg
 * @returns {{}}
 */
wxTool.getWxSignature = function(req ,jsapiTicket ,channel,shareUrl,shareTitle,shareContent,shareImg,url){
	if(!(channel in wxConf)){
		channel = wxConf["default"].nameSpace;
	}
	let finalJson = {};
	finalJson.timestamp = Math.floor( new Date().getTime()/1000);
	finalJson.url = url?url :(req.protocol+"://"+req.headers.host+req.originalUrl);

	finalJson.shareTitle = shareTitle ? shareTitle : req.session.shareTitle;
	finalJson.shareContent = shareContent ? shareContent : req.session.shareContent;
	finalJson.shareImg = shareImg ? shareImg : req.session.shareImg;
	finalJson.shareUrl = shareUrl ? shareUrl : req.session.shareUrl;

	finalJson.noncestr = "pater";
	finalJson.appId = wxConf[channel].appId;
	loggerInfo.info("签名str : " + `jsapi_ticket=${jsapiTicket}&noncestr=${finalJson.noncestr}&timestamp=${finalJson.timestamp}&url=${finalJson.url}`);
	finalJson.signature = crypto.getSha1(`jsapi_ticket=${jsapiTicket}&noncestr=${finalJson.noncestr}&timestamp=${finalJson.timestamp}&url=${finalJson.url}`);
	return finalJson;
};

wxTool.getJsapiTicketOneStep = function(channel , resolveBase){
	co(function* () {
		if(!(channel in wxConf)){
			channel = wxConf["default"].nameSpace;
		}
		let jsapiTicket = yield new Promise((resolve, reject) => {
			redisTool.get(redisConf.redisPrefix+channel+"-"+"jsapiTicket", function (error, response) {
				if (!error && response) {
					resolveBase(response); //释放外部锁
					resolve(response);//释放内部锁
				} else { //jsapiTicket 不存在
					loggerInfo.info("redisKey -> " + redisConf.redisPrefix +channel+"-" + "jsapiTicket 不存在，重新获取");
					resolve("");
				}
			});
		});
		if (!jsapiTicket || jsapiTicket == "") { // 如果jsapiTicket 不存在
			let accessToken = yield new Promise((resolve, reject) => {
				redisTool.get(redisConf.redisPrefix +channel+"-" + "accessToken", function (error, response) {
					if (!error && response) {
						resolve(response); //获取到accessToken
					} else { //accessToken不存在
						loggerInfo.info("redisKey -> " + redisConf.redisPrefix +channel+"-" + "accessToken 不存在，重新获取");
						wxTool.getAccessToken(channel,function (res2) {
							let data = '';
							res2.on('data', (chunk) => {
								data += chunk;
							});
							res2.on('end', function () {
								try {
									//获取到的数据
									loggerInfo.info("获取access_token : " + data);
									let json = JSON.parse(data);
									if ("access_token" in json) {
										redisTool.set(redisConf.redisPrefix +channel+"-" + "accessToken", json["access_token"], function (e1, e2) {
											if (!e1) {
												redisTool.expire(redisConf.redisPrefix +channel+"-" + "accessToken", 7200, function (e2, r2) {
													loggerInfo.info("access_token : " + json["access_token"] + "设置时间为7200S");
												});
											}
										});
										resolve(json["access_token"]);
									} else {
										resolveBase("");
										resolve("");
									}
								} catch (e) {
									loggerError.error("获取accessToken失败");
									resolveBase("");
									resolve("");
								}
							});
						});
					}
				});
			});
			if(accessToken){
				jsapiTicket = yield new Promise((resolve, reject) => {
					wxTool.getJsapiTicketo(accessToken, function (res2) {
						let data = '';
						res2.on('data', (chunk) => {
							data += chunk;
						});
						res2.on('end', function () {
							try {
								//获取到的数据
								loggerInfo.info("获取jsapiTicket : " + data);
								let json = JSON.parse(data);
								redisTool.set(redisConf.redisPrefix +channel+"-" + "jsapiTicket", json.ticket, function (e1, e2) {
									if (!e1) {
										redisTool.expire(redisConf.redisPrefix +channel+"-" + "jsapiTicket", 7200, function (e2, r2) {
											loggerInfo.info("jsapiTicket : " + json.ticket + "设置时间为7200S");
										});
									}
								});
								resolveBase(json.ticket);
								resolve(json.ticket);
							} catch (e) {
								loggerError.error("获取jsapiTicket失败");
								resolveBase(json.ticket);
								resolve("");
							}
						});
					});
				});
			}

		}
	});
};

wxTool.getAccessTokenOneStep = function(channel , resolveBase){
	co(function* () {
		let accessToken = yield new Promise((resolve, reject) => {
			redisTool.get(redisConf.redisPrefix +channel+"-" + "accessToken", function (error, response) {
				if (!error && response) {
					resolve(response); //获取到accessToken
					resolveBase(response);
				} else { //accessToken不存在
					loggerInfo.info("redisKey -> " + redisConf.redisPrefix +channel+"-" + "accessToken 不存在，重新获取");
					wxTool.getAccessToken(channel,function (res2) {
						let data = '';
						res2.on('data', (chunk) => {
							data += chunk;
						});
						res2.on('end', function () {
							try {
								//获取到的数据
								loggerInfo.info("获取access_token : " + data);
								let json = JSON.parse(data);
								if ("access_token" in json) {
									redisTool.set(redisConf.redisPrefix +channel+"-" + "accessToken", json["access_token"], function (e1, e2) {
										if (!e1) {
											redisTool.expire(redisConf.redisPrefix +channel+"-" + "accessToken", 7200, function (e2, r2) {
												loggerInfo.info("access_token : " + json["access_token"] + "设置时间为7200S");
											});
										}
									});
									resolve(json["access_token"]);
									resolveBase(json["access_token"]);
								} else {
									resolveBase("");
									resolve("");
								}
							} catch (e) {
								loggerError.error("获取accessToken失败");
								resolveBase("");
								resolve("");
							}
						});
					});
				}
			});
		});
	});
};
module.exports = wxTool;