var express = require('express');
var router = express.Router();
const co = require('co');
const http = require('http');
const https = require('https');
const log4js = require('log4js');
const loggerInfo = log4js.getLogger("default");
const loggerError = log4js.getLogger("error");
const fs = require('fs');
const wxTool = require('../tool/wxTool');
const redisTool = require('../tool/redisTool');
const redisConf = require('../config/redisConf');

const cryptoTool = require('../tool/crypto');

const multipart = require('connect-multiparty');
const multipartMiddleware = multipart();
const fileName = `./sup/bejson.json`;
const reqUrlFileName = `./sup/reqUrl.json`;
const dataFileName = `./sup/data.json`;
const channel = "prd";

/* GET home page. */
router.get('/', function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        if ("code" in req.body) {
            let openId = yield new Promise((resolve, reject) => {
                wxTool.getUserOpenId(channel, req.body.code, function (res2) {
                    let data = '';
                    res2.on('data', (chunk) => {
                        data += chunk;
                    });
                    res2.on('end', function () {
                        try {
                            //获取到的数据
                            loggerInfo.info("openid : " + data);
                            let json = JSON.parse(data);
                            if ("openid" in json) {
                                resolve(json.openid);
                            } else {
                                resolve("");
                            }
                        } catch (e) {
                            loggerError.error("获取openid失败");
                            resolve("");
                        }
                    });
                });
            });
            req.session.openId = openId;
        }

        let accessToken = yield new Promise((resolve, reject) => {
            redisTool.get(redisConf.redisPrefix + channel + "-" + "accessToken", function (error, response) {
                if (!error && response) {
                    resolve(response); //获取到accessToken
                } else { //accessToken不存在
                    loggerInfo.info("redisKey -> " + redisConf.redisPrefix + channel + "-" + "accessToken 不存在，重新获取");
                    wxTool.getAccessToken(channel, function (res2) {
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
                                    redisTool.set(redisConf.redisPrefix + channel + "-" + "accessToken", json["access_token"], function (e1, e2) {
                                        if (!e1) {
                                            redisTool.expire(redisConf.redisPrefix + channel + "-" + "accessToken", 7200, function (e2, r2) {
                                                loggerInfo.info("access_token : " + json["access_token"] + "设置时间为7200S");
                                            });
                                        }
                                    });
                                    resolve(json["access_token"]);
                                } else {
                                    resolve("");
                                }
                            } catch (e) {
                                loggerError.error("获取accessToken失败");
                                resolve("");
                            }
                        });
                    });
                }
            });
        });
        console.log(accessToken)
        res.render('index');

    });

});

router.get('/calc/:entCode', function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};

        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("calc", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("calc", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        try {
            let result = yield new Promise((resolved1, rejected1) => {
                defendBaseInfo(json, resolved1, rejected1);
            });
            if (result == "error") {
                res.render("errorCenter", {"msg": "获取工会成员失败"});
                return;
            } else {
                dateJson[req.body.entCode] = result;
                fs.writeFileSync(fileName, JSON.stringify(dateJson));
            }

            res.render("entCodePage", {"entCode": req.body.entCode});
        } catch (e) {
            loggerError.error(e);
            res.render("errorCenter", {"msg": "系统异常"});
            return;
        }
    });
});

function defendBaseInfo(entJson, resolved1, rejected1) {
    co(function* () {
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("defendBaseInfo", e);
            return "error";
        }

        let now = new Date().getTime();
        if (Number(now) - Number(entJson.lastUpdateMemDate) > 30 * 60 * 1000) {
            const options = {
                hostname: reqUrlJson.hostName,
                port: 443,
                path: reqUrlJson.memberUrl,
                method: 'GET',
                rejectUnauthorized: false,
                headers: {
                    "Cookie": entJson.cookie,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
                },
                key: "",
                cert: ""
            };
            let httpresult = yield new Promise((resolved, rejected) => {
                let req1 = https.request(options, function (res) {
                    res.setEncoding('utf8');
                    let data = "";
                    res.on('data', function (chunk) {
                        console.log('BODY: ' + chunk);
                        data += chunk;
                    });
                    res.on('end', () => {
                        resolved(data);
                    });
                });
                req1.on('error', function (e) {
                    console.log('problem with request: ' + e.message);
                    resolved("ok")
                });
                req1.write("");
                req1.end();
            });
            const resJson = JSON.parse(httpresult);
            if (resJson['code'] == 0) {
                entJson.lastUpdateMemDate = now;
                entJson.member = resJson.data.member;
                entJson.dateSize = resJson.data.date.length;
                entJson.dateArray = resJson.data.date;
                now = new Date();
                let month = now.getMonth() + 1;
                let date = now.getDate();
                date = `${now.getFullYear()}-${month < 10 ? '0' + month : month}-${date < 10 ? '0' + date : date}`


                if (resJson.data.date[0] != date) {
                    checkUserInfo(entJson);
                }
                resolved1(entJson);
                return entJson;
            } else {
                resolved1("error");
                return "error";
            }

        } else {
            resolved1(entJson);
            return entJson;
        }
    });

}

function checkUserInfo(json) {
    let dateJson = {};
    let reqUrlJson = {};
    try {
        reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
    } catch (e) {
        loggerError.error("calc", e);
    }

    const options = {
        hostname: reqUrlJson.hostName,
        port: 443,
        path: reqUrlJson.checkUserInfo,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
            "Cookie": json.cookie,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
        },
        key: "",
        cert: ""
    };
    var req = https.request(options, function (res) {
        res.setEncoding('utf8');
        let data = "";
        res.on('data', function (chunk) {
            console.log('BODY: ' + chunk);
            data += chunk;
        });
        res.on('end', () => {
        });
    });
    req.on('error', function (e) {
        console.log('problem with request: ' + e.message);
    });
    req.write("");
    req.end();
}

router.get('/opMemWxName/:entCode', function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};

        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);

        } catch (e) {
            loggerError.error("opMemWxName", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("calc", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let result = yield new Promise((resolved1, rejected1) => {
            defendBaseInfo(json, resolved1, rejected1);
        });
        if (result == "error") {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        } else {
            dateJson[req.body.entCode] = result;
            json = result;
            fs.writeFileSync(fileName, JSON.stringify(dateJson));
        }

        let idArray = [];
        for (let i in json.member) {
            let id = json.member[i].id;
            idArray.push(id);
            let name = json.member[i].name;
            if (!(id in json.mem2WX)) {
                json.mem2WX[id] = {
                    "name": name,
                    "wxName": name
                }
            }
        }
        //需要移除 一次未在成员内的人员
        let mem2WX = {};
        for (let id in json.mem2WX) {
            for (let idx in idArray) {
                if (idArray[idx] == id) {
                    mem2WX[id] = json.mem2WX[id];
                    continue;
                }
            }

        }
        json.mem2WX = mem2WX;
        fs.writeFileSync(fileName, JSON.stringify(dateJson));


        res.render("opMemWxName", {"entCode": req.body.entCode, "mem2Wx": json.mem2WX});

    });
});

router.post('/saveMemWxName/:entCode', multipartMiddleware, function (req, res, next) {
    req.body = Object.assign(req.body, req.query);
    req.body.entCode = req.params.entCode;
    let json = {};
    let dateJson = {};

    try {
        let json1 = fs.readFileSync(fileName, "utf-8");
        dateJson = JSON.parse(json1);

    } catch (e) {
        loggerError.error("opMemWxName", e);
    }
    if (!(req.body.entCode in dateJson)) {
        res.render("errorCenter", {msg: "无该工会"});
        return;
    }
    dateJson[req.body.entCode].mem2WX = JSON.parse(req.body.wxName);

    fs.writeFileSync(fileName, JSON.stringify(dateJson));
    res.send({"ret": 0});
});

router.get('/genData/:entCode', function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};


        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("genData", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("calc", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let result = yield new Promise((resolved1, rejected1) => {
            defendBaseInfo(json, resolved1, rejected1);
        });
        if (result == "error") {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        } else {
            dateJson[req.body.entCode] = result;
            json = result;
            fs.writeFileSync(fileName, JSON.stringify(dateJson));
        }

        const options = {
            hostname: reqUrlJson.hostName,
            port: 443,
            path: reqUrlJson.memberDataUrl + req.body.date,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                "Cookie": json.cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
            },
            key: "",
            cert: ""
        };
        let httpresult = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const resJson = JSON.parse(httpresult);
        console.log(httpresult);

        options.path = reqUrlJson.statisticsUrl.replace("date=", "date=" + req.body.date);
        let oneStatisticsStr = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const oneStatistics = JSON.parse(oneStatisticsStr);
        console.log(oneStatisticsStr);
        //分组 分出来 每个人出了几种刀型
        let userRoleListData = {};
        if (oneStatistics['code'] == 0) {
            for (let i in oneStatistics.data) {
                let user_name = oneStatistics.data[i].user_name;
                let role_list = oneStatistics.data[i].role_list;
                let log_time = oneStatistics.data[i].log_time;
                if (!(user_name in userRoleListData)) {
                    userRoleListData[user_name] = {
                        damType: 0,
                        roleList: [],
                        roleData: {}
                    };
                }
                //判断 roleList 中存不存在 已出的角色， 存在就是同刀型 筛选重复出刀的队伍
                let damType = 0;
                let iconList = [];
                for (let ii in role_list) {
                    if (userRoleListData[user_name].roleList.indexOf(role_list[ii].icon) < 0) {
                        damType++;
                    }
                    userRoleListData[user_name].roleList.push(role_list[ii].icon);
                    iconList.push(role_list[ii].icon);
                }
                iconList.sort((a,b)=>{ return a>b});
                const afterMd5 = cryptoTool.getMd5(JSON.stringify(iconList));
                if (damType > 0) {
                    userRoleListData[user_name].damType++;
                    userRoleListData[user_name].roleData[afterMd5] = [];
                }
                userRoleListData[user_name].roleData[afterMd5].push(log_time);

            }
        }

        if (resJson['code'] == 0) {
            let userData = {};
            for (let i in resJson.data) {
                //由于出现补偿刀， 计算伤害刀的时候 需要把击杀的刀 做补偿机制
                let damage_num = 0;
                let kill_num = 0;
                let killLog = {};
                for (let ii in resJson.data[i].damage_list) {
                    let is_kill = resJson.data[i].damage_list[ii].is_kill;
                    let log_time = resJson.data[i].damage_list[ii].log_time;
                    if (is_kill == 0) {
                        damage_num++;
                    } else {
                        kill_num++;
                        killLog[log_time] = is_kill;
                    }
                }
                userData[resJson.data[i].user_id] = {damage_num: damage_num, kill_num: kill_num, killLog: killLog};
            }
            let noDataUser = '';
            for (let i in json.member) {
                let id = json.member[i].id;
                let name = json.member[i].name;
                let wxName = id in json.mem2WX ? json.mem2WX[id].wxName : "";
                if (!(id in userData)) {
                    noDataUser += `@${wxName ? wxName : name} 缺3刀,击杀0刀; `;
                } else {
                    let num = userData[id].damage_num;
                    let kill_num = userData[id].kill_num;
                    let killLog = userData[id].killLog;
                    let damType = userRoleListData[name].damType;
                    if (kill_num > 1) {
                        let damType = userRoleListData[name].damType;
                        let finishDamType = 0; //完成出刀
                        for (let keyIdx in Object.keys(userRoleListData[name].roleData)) {
                            let key = Object.keys(userRoleListData[name].roleData)[keyIdx];
                            if (userRoleListData[name].roleData[key].length == 2) {
                                finishDamType++;
                            } else {
                                //判断这刀是不是击杀刀
                                let iskill = killLog[userRoleListData[name].roleData[key][0]];
                                if (iskill == undefined) {
                                    finishDamType++;
                                }
                            }
                        }
                        if (finishDamType == 3) {
                            //已完成三刀刀型
                        } else {
                            noDataUser += `@${wxName ? wxName : name} 缺${3 - finishDamType}刀,击杀${kill_num}刀; `;
                        }
                    } else {
                        num = 3 - Number(num);
                        if (num != 0) {
                            noDataUser += `@${wxName ? wxName : name} 缺${num}刀,击杀${kill_num}刀; `;
                        }
                    }
                }
            }
            res.render("data", {"data": noDataUser});
        } else {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        }


    });
});

router.get('/bossData/:entCode', function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};


        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("genData", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("calc", e);
        }
        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        const options = {
            hostname: reqUrlJson.hostName,
            port: 443,
            path: reqUrlJson.bossUrl,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                "Cookie": json.cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
            },
            key: "",
            cert: ""
        };
        let httpresult = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    console.log('BODY: ' + chunk);
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const resJson = JSON.parse(httpresult);
        if (resJson['code'] == 0) {
            res.render("bossData", {"round": resJson.data.round, "array": resJson.data.boss});
            return;
        } else {
            res.render("errorCenter", {"msg": "获取BOSS数据失败"});
            return;
        }
    });
});

router.get('/statistic/:entCode', function (req, res, next) {

    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};
        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("statistic", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("statistic", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let result = yield new Promise((resolved1, rejected1) => {
            defendBaseInfo(json, resolved1, rejected1);
        });
        if (result == "error") {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        } else {
            dateJson[req.body.entCode] = result;
            json = result;
            fs.writeFileSync(fileName, JSON.stringify(dateJson));
        }


        const options = {
            hostname: reqUrlJson.hostName,
            port: 443,
            path: reqUrlJson.statisticsUrl,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                "Cookie": json.cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
            },
            key: "",
            cert: ""
        };
        let httpresult = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const resJson = JSON.parse(httpresult);
        console.log(httpresult);

        // 根据日期来 计算每天击杀刀 和伤害刀
        let userData4Date = {};
        for (let i in json.dateArray) {
            let date = json.dateArray[i];
            options.path = reqUrlJson.memberDataUrl.replace("date=", "date=" + date);
            let oneMemberDataStr = yield new Promise((resolved, rejected) => {
                var req = https.request(options, function (res) {
                    res.setEncoding('utf8');
                    let data = "";
                    res.on('data', function (chunk) {
                        data += chunk;
                    });
                    res.on('end', () => {
                        resolved(data);
                    });
                });
                req.on('error', function (e) {
                    console.log('problem with request: ' + e.message);
                    resolved("ok")
                });
                req.write("");
                req.end();
            });
            const oneMemberData = JSON.parse(oneMemberDataStr);
            console.log(oneMemberDataStr);
            if (oneMemberData['code'] == 0) {
                for (let ii in oneMemberData.data) {
                    let userName = oneMemberData.data[ii].user_name;
                    let damage_num = 0;
                    let kill_num = 0;
                    let killLog = {};
                    for (let iii in oneMemberData.data[ii].damage_list) {
                        let is_kill = oneMemberData.data[ii].damage_list[iii].is_kill;
                        let log_time = oneMemberData.data[ii].damage_list[iii].log_time;
                        if (is_kill == 0) {
                            damage_num++;
                        } else {
                            kill_num++;
                            killLog[log_time] = is_kill;
                        }
                    }
                    if (!(userName in userData4Date)) {
                        userData4Date[userName] = {};
                    }
                    userData4Date[userName][date] = {damage_num: damage_num, kill_num: kill_num, killLog: killLog};
                }
            }
        }

        if (resJson['code'] == 0) {
            // 计算总刀数
            let memberNum = json.member.length;
            let dateSize = json.dateSize;
            let total = 3 * dateSize;

            let name2Wx = {};
            for (let key in json.mem2WX) {
                name2Wx[json.mem2WX[key].name] = json.mem2WX[key].wxName;
            }

            let userData = {};
            //先分下 每日 刀型
            let userRoleListData = {};
            for (let i in resJson.data) {
                let user_name = resJson.data[i].user_name;
                let role_list = resJson.data[i].role_list;
                let log_time = resJson.data[i].log_time;
                let date = new Date(log_time * 1000);
                let dateStr = date.getFullYear() + "-"
                    + (date.getMonth() < 9 ? "0" : "") + ((date.getMonth() + 1)) + "-"
                    + (date.getDate() < 10 ? "0" : "") + ((date.getDate()));

                if (!(user_name in userRoleListData)) {
                    userRoleListData[user_name] = {};
                }
                if (!(dateStr in userRoleListData[user_name])) {
                    userRoleListData[user_name][dateStr] = {
                        damType: 0,
                        roleList: [],
                        roleData: {}
                    };
                }

                //判断 roleList 中存不存在 已出的角色， 存在就是同刀型
                let damType = 0;
                let iconList = [];
                for (let ii in role_list) {
                    if (userRoleListData[user_name][dateStr].roleList.indexOf(role_list[ii].icon) < 0) {
                        damType++;
                    }
                    userRoleListData[user_name][dateStr].roleList.push(role_list[ii].icon);
                    iconList.push(role_list[ii].icon);
                }
                iconList.sort((a,b)=>{ return a>b});

                const afterMd5 = cryptoTool.getMd5(JSON.stringify(iconList));
                if (damType > 0) {
                    userRoleListData[user_name][dateStr].damType++;
                    userRoleListData[user_name][dateStr].roleData[afterMd5] = [];
                }
                    userRoleListData[user_name][dateStr].roleData[afterMd5].push(log_time);


                let userName = resJson.data[i].user_name;
                let damage = resJson.data[i].damage;
                let bossName = resJson.data[i].boss.name;
                if (!(userName in userData)) {
                    userData[userName] = {
                        userName: userName,
                        wxName: name2Wx[userName],
                        bossName: {},
                        total: 0,
                        miss: 0
                    };
                }
                if (!(bossName in userData[userName].bossName)) {
                    userData[userName].bossName[bossName] = {
                        "count": 0,
                        "damage": 0
                    }
                }
                userData[userName].total = userData[userName].total + 1;
                userData[userName].bossName[bossName] = {
                    "count": userData[userName].bossName[bossName].count + 1,
                    "damage": userData[userName].bossName[bossName].damage + Number(damage)
                }

            }


            for (let user_name in userData) {
                let miss = 0;
                for (let i in json.dateArray) {
                    let date = json.dateArray[i];
                    if (date in userData4Date[user_name]) {
                        let num = userData4Date[user_name][date].damage_num;
                        let kill_num = userData4Date[user_name][date].kill_num;
                        let killLog = userData4Date[user_name][date].killLog;
                        let damType = userRoleListData[user_name][date].damType;
                        if (kill_num > 1) {
                            let finishDamType = 0; //完成出刀
                            for (let keyIdx in Object.keys(userRoleListData[user_name][date].roleData)) {
                                let key = Object.keys(userRoleListData[user_name][date].roleData)[keyIdx];
                                if (userRoleListData[user_name][date].roleData[key].length == 2) {
                                    finishDamType++;
                                } else {
                                    //判断这刀是不是击杀刀
                                    if (key in userRoleListData[user_name][date].roleData) {
                                        let iskill = killLog[userRoleListData[user_name][date].roleData[key][0]];
                                        if (iskill == undefined) {
                                            finishDamType++;
                                        }
                                    }
                                }
                            }
                            miss += 3 - finishDamType;
                        } else {
                            num = 3 - Number(num);
                            if (num != 0) {
                                miss += num
                            }
                        }
                    } else {
                        miss += 3
                    }
                }
                userData[user_name].miss = miss;
            }

            res.render("statistic", {"userData": userData, "total": total});
        } else {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        }
    });

});

router.get("/statistic/table/:entCode", function (req, res, next) {

    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};

        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("calc", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("statistic/table", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let result = yield new Promise((resolved1, rejected1) => {
            defendBaseInfo(json, resolved1, rejected1);
        });
        if (result == "error") {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        } else {
            dateJson[req.body.entCode] = result;
            json = result;
            fs.writeFileSync(fileName, JSON.stringify(dateJson));
        }

        const options = {
            hostname: reqUrlJson.hostName,
            port: 443,
            path: reqUrlJson.memberUrl,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                "Cookie": json.cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
            },
            key: "",
            cert: ""
        };
        let httpresult = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const resJson = JSON.parse(httpresult);

        if (resJson['code'] == 0) {
            let dateArray = resJson.data.date;
            // {bossData:{"bossName":{"userName":{max:"",count:"",damage:"",kill:"count"}}}}
            let bossData = {};
            for (let i in dateArray) {
                options.path = reqUrlJson.memberDataUrl + dateArray[i];

                let oneDataJsonStr = yield new Promise((resolved, rejected) => {
                    var req = https.request(options, function (res) {
                        res.setEncoding('utf8');
                        let data = "";
                        res.on('data', function (chunk) {
                            data += chunk;
                        });
                        res.on('end', () => {
                            resolved(data);
                        });
                    });
                    req.on('error', function (e) {
                        console.log('problem with request: ' + e.message);
                        resolved("ok")
                    });
                    req.write("");
                    req.end();
                });
                const oneDataJson = JSON.parse(oneDataJsonStr);
                console.log(oneDataJsonStr);

                options.path = reqUrlJson.statisticsUrl.replace("date=", "date=" + dateArray[i]);
                let oneStatisticsStr = yield new Promise((resolved, rejected) => {
                    var req = https.request(options, function (res) {
                        res.setEncoding('utf8');
                        let data = "";
                        res.on('data', function (chunk) {
                            data += chunk;
                        });
                        res.on('end', () => {
                            resolved(data);
                        });
                    });
                    req.on('error', function (e) {
                        console.log('problem with request: ' + e.message);
                        resolved("ok")
                    });
                    req.write("");
                    req.end();
                });
                const oneStatistics = JSON.parse(oneStatisticsStr);
                //根据 userName + log_time 分组
                let roleList = {};
                if (oneStatistics['code'] == 0) {
                    for (let ii in oneStatistics.data) {
                        let userName = oneStatistics.data[ii].user_name;
                        let logTime = oneStatistics.data[ii].log_time;
                        let role_List = oneStatistics.data[ii].role_list;
                        roleList[`${userName}_${logTime}`] = role_List;
                    }
                }
                // memberDataUrl
                //{"code":0,"data":[{"user_id":1000197351,"user_name":"Applause","damage_num":3,"damage_total":40279976,"damage_list":[{"damage":14314718,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665022620,"is_kill":0},{"damage":14302347,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665022897,"is_kill":0},{"damage":11662911,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665023029,"is_kill":0}]},{"user_id":1000218505,"user_name":"李知恩","damage_num":2,"damage_total":19237080,"damage_list":[{"damage":13365564,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664988353,"is_kill":0},{"damage":5871516,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664988415,"is_kill":1}]},{"user_id":1000222972,"user_name":"可爱小勇士","damage_num":3,"damage_total":41313196,"damage_list":[{"damage":13658883,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664986213,"is_kill":0},{"damage":11797680,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664986308,"is_kill":0},{"damage":15856633,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665017792,"is_kill":0}]},{"user_id":1000662939,"user_name":"金闪闪","damage_num":3,"damage_total":45460454,"damage_list":[{"damage":15126234,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665016298,"is_kill":0},{"damage":17128670,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665016417,"is_kill":0},{"damage":13205550,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665016513,"is_kill":0}]},{"user_id":1000753409,"user_name":"Ki","damage_num":3,"damage_total":41229307,"damage_list":[{"damage":11002147,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665020265,"is_kill":0},{"damage":17215832,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665020370,"is_kill":0},{"damage":13011328,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665020456,"is_kill":0}]},{"user_id":1000756049,"user_name":"不解释OO","damage_num":3,"damage_total":35807589,"damage_list":[{"damage":9670562,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664986276,"is_kill":0},{"damage":14457108,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664986377,"is_kill":0},{"damage":11679919,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664986507,"is_kill":0}]},{"user_id":1000759093,"user_name":"夜白","damage_num":3,"damage_total":40688605,"damage_list":[{"damage":14177304,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664986570,"is_kill":0},{"damage":11902264,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664986671,"is_kill":0},{"damage":14609037,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664986791,"is_kill":0}]},{"user_id":1000864170,"user_name":"kk桑","damage_num":3,"damage_total":30936064,"damage_list":[{"damage":8823515,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1665012443,"is_kill":1},{"damage":12798791,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1665012591,"is_kill":0},{"damage":9313758,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1665013021,"is_kill":1}]},{"user_id":1001070169,"user_name":"杏殿下","damage_num":3,"damage_total":32114600,"damage_list":[{"damage":14055087,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665024407,"is_kill":0},{"damage":9428425,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665024543,"is_kill":0},{"damage":8631088,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665024653,"is_kill":0}]},{"user_id":1001070899,"user_name":"xxxzuzae丶","damage_num":3,"damage_total":32598746,"damage_list":[{"damage":14343357,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665016097,"is_kill":0},{"damage":10262319,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665016195,"is_kill":0},{"damage":7993070,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665016296,"is_kill":0}]},{"user_id":1001123613,"user_name":"爱追风的叶子","damage_num":3,"damage_total":47688792,"damage_list":[{"damage":17903529,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665020002,"is_kill":0},{"damage":13150868,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665020090,"is_kill":0},{"damage":16634395,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665020242,"is_kill":0}]},{"user_id":1001163435,"user_name":"哈撒ki","damage_num":3,"damage_total":45921933,"damage_list":[{"damage":10990619,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664987247,"is_kill":0},{"damage":17681184,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664987337,"is_kill":0},{"damage":17250130,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665020402,"is_kill":0}]},{"user_id":1001373198,"user_name":"DLan","damage_num":3,"damage_total":46119061,"damage_list":[{"damage":15146025,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664985678,"is_kill":0},{"damage":12941188,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664985772,"is_kill":0},{"damage":18031848,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664985926,"is_kill":0}]},{"user_id":1001501977,"user_name":"巨棍向西摇","damage_num":3,"damage_total":34185688,"damage_list":[{"damage":13475183,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664987512,"is_kill":0},{"damage":10459800,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664987621,"is_kill":0},{"damage":10250705,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664987713,"is_kill":0}]},{"user_id":1001776844,"user_name":"Freya","damage_num":3,"damage_total":42676911,"damage_list":[{"damage":15202621,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664985702,"is_kill":0},{"damage":16161692,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664985797,"is_kill":0},{"damage":11312598,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664986059,"is_kill":0}]},{"user_id":1002183993,"user_name":"蒜蓉扇贝","damage_num":3,"damage_total":40052867,"damage_list":[{"damage":14303227,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1665012757,"is_kill":0},{"damage":14963833,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665016252,"is_kill":0},{"damage":10785807,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665016499,"is_kill":0}]},{"user_id":1002503778,"user_name":"切克闹","damage_num":3,"damage_total":36234601,"damage_list":[{"damage":12226728,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664986396,"is_kill":0},{"damage":10622839,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664988271,"is_kill":0},{"damage":13385034,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664988843,"is_kill":0}]},{"user_id":1002520094,"user_name":"涩涩糖心可可小馒头","damage_num":3,"damage_total":47528915,"damage_list":[{"damage":15571759,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664986248,"is_kill":0},{"damage":13425550,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664988400,"is_kill":0},{"damage":18531606,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664988485,"is_kill":0}]},{"user_id":1002689103,"user_name":"Ki","damage_num":3,"damage_total":41448743,"damage_list":[{"damage":17434885,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665019448,"is_kill":0},{"damage":11330678,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665019600,"is_kill":0},{"damage":12683180,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665019692,"is_kill":0}]},{"user_id":1002729549,"user_name":"大斜","damage_num":3,"damage_total":48492700,"damage_list":[{"damage":9846931,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664989391,"is_kill":1},{"damage":19469614,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664989514,"is_kill":0},{"damage":19176155,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665038066,"is_kill":0}]},{"user_id":1003136873,"user_name":"oegg","damage_num":3,"damage_total":42961611,"damage_list":[{"damage":16557986,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1665012246,"is_kill":0},{"damage":12974038,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1665012433,"is_kill":0},{"damage":13429587,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665017365,"is_kill":0}]},{"user_id":1003312883,"user_name":"鬼魈","damage_num":3,"damage_total":44732950,"damage_list":[{"damage":19165765,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665016961,"is_kill":0},{"damage":12510781,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665017200,"is_kill":0},{"damage":13056404,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665017374,"is_kill":0}]},{"user_id":1003899125,"user_name":"柚柚","damage_num":3,"damage_total":44816708,"damage_list":[{"damage":15001540,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665016258,"is_kill":0},{"damage":15972823,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665016352,"is_kill":0},{"damage":13842345,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665016463,"is_kill":0}]},{"user_id":1004108357,"user_name":"黑色灯光","damage_num":3,"damage_total":40324591,"damage_list":[{"damage":15757964,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665027000,"is_kill":0},{"damage":10797155,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665027112,"is_kill":0},{"damage":13769472,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665027233,"is_kill":0}]},{"user_id":1004498265,"user_name":"xx","damage_num":3,"damage_total":37438704,"damage_list":[{"damage":13171563,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664985759,"is_kill":0},{"damage":11782726,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664985913,"is_kill":0},{"damage":12484415,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664986016,"is_kill":0}]},{"user_id":1006090992,"user_name":"一刀999","damage_num":3,"damage_total":43254368,"damage_list":[{"damage":10218456,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664986758,"is_kill":0},{"damage":17956262,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664986857,"is_kill":0},{"damage":15079650,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665025075,"is_kill":0}]},{"user_id":1006162706,"user_name":"生不留恋","damage_num":3,"damage_total":39968870,"damage_list":[{"damage":15406376,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665029584,"is_kill":0},{"damage":11379236,"boss_id":4003082,"boss_name":"妖精","round":39,"log_time":1665029681,"is_kill":0},{"damage":13183258,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665029791,"is_kill":0}]},{"user_id":1006625957,"user_name":"不解释pp々","damage_num":3,"damage_total":45158905,"damage_list":[{"damage":15559987,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":38,"log_time":1664985732,"is_kill":0},{"damage":16140782,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":38,"log_time":1664985817,"is_kill":0},{"damage":13458136,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664985925,"is_kill":0}]},{"user_id":1007872665,"user_name":"Siseysei","damage_num":3,"damage_total":37547947,"damage_list":[{"damage":11828346,"boss_id":4003082,"boss_name":"妖精","round":38,"log_time":1664988642,"is_kill":0},{"damage":14191718,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664988745,"is_kill":0},{"damage":11527883,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":38,"log_time":1664988924,"is_kill":0}]},{"user_id":1009176869,"user_name":"米奇小魔王","damage_num":3,"damage_total":40900039,"damage_list":[{"damage":15847151,"boss_id":1015082,"boss_name":"创始人艾芙芭","round":39,"log_time":1665033303,"is_kill":0},{"damage":10681237,"boss_id":1014082,"boss_name":"改良疯狂熊猫MK-三型","round":39,"log_time":1665033446,"is_kill":0},{"damage":14371651,"boss_id":1012082,"boss_name":"愤怒的牛头人","round":39,"log_time":1665033581,"is_kill":0}]}]}
                // statisticsUrl
                // {"code":0,"data":[{"server_time":1665236942,"log_time":1665038066,"user_name":"大斜","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":19176155,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":152876,"toughness":305364,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":142528,"toughness":392269,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":101487,"toughness":293685,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":107015,"toughness":240479,"recovery":0}]},{"server_time":1665236942,"log_time":1665033581,"user_name":"米奇小魔王","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":14371651,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":137374,"toughness":307809,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":98951,"toughness":332454,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":101905,"toughness":376779,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":127030,"toughness":390555,"recovery":0}]},{"server_time":1665236942,"log_time":1665033446,"user_name":"米奇小魔王","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":10681237,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":130612,"toughness":559613,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":110173,"toughness":500703,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":111909,"toughness":387496,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":79535,"toughness":241716,"recovery":0}]},{"server_time":1665236942,"log_time":1665033303,"user_name":"米奇小魔王","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":15847151,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":135671,"toughness":527573,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":135503,"toughness":522553,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":126892,"toughness":497248,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":107349,"toughness":495164,"recovery":0}]},{"server_time":1665236942,"log_time":1665029791,"user_name":"生不留恋","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":13183258,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":137677,"toughness":271597,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":137272,"toughness":381053,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":103137,"toughness":366251,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":100838,"toughness":474666,"recovery":0}]},{"server_time":1665236942,"log_time":1665029681,"user_name":"生不留恋","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11379236,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":85554,"toughness":432406,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":118477,"toughness":361200,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":116195,"toughness":341317,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":123573,"toughness":472103,"recovery":0}]},{"server_time":1665236942,"log_time":1665029584,"user_name":"生不留恋","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":15406376,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":114807,"toughness":566334,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":139532,"toughness":502445,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":123072,"toughness":506779,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":105696,"toughness":432260,"recovery":0}]},{"server_time":1665236942,"log_time":1665027233,"user_name":"黑色灯光","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":13769472,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":139845,"toughness":296167,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":120938,"toughness":359570,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":106638,"toughness":435090,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":103092,"toughness":332031,"recovery":0}]},{"server_time":1665236942,"log_time":1665027112,"user_name":"黑色灯光","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":10797155,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/knight_male.png","dps":89005,"toughness":290754,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":110192,"toughness":297723,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":113236,"toughness":437520,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":122050,"toughness":360028,"recovery":0}]},{"server_time":1665236942,"log_time":1665027000,"user_name":"黑色灯光","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":15757964,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":141571,"toughness":486902,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":119707,"toughness":521037,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":128775,"toughness":458815,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":118613,"toughness":492248,"recovery":0}]},{"server_time":1665236942,"log_time":1665025075,"user_name":"一刀999","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15079650,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":140018,"toughness":267317,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":95415,"toughness":432114,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":93330,"toughness":327194,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":138463,"toughness":351098,"recovery":0}]},{"server_time":1665236942,"log_time":1665024653,"user_name":"杏殿下","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":8631088,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":133375,"toughness":551366,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":107527,"toughness":301236,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":97742,"toughness":484319,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":68344,"toughness":156610,"recovery":0}]},{"server_time":1665236942,"log_time":1665024543,"user_name":"杏殿下","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":9428425,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":87913,"toughness":405561,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":117963,"toughness":401214,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":101530,"toughness":311194,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":106491,"toughness":306255,"recovery":0}]},{"server_time":1665236942,"log_time":1665024407,"user_name":"杏殿下","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":14055087,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":119915,"toughness":505710,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":119725,"toughness":460413,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":123160,"toughness":439814,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":110238,"toughness":451897,"recovery":0}]},{"server_time":1665236942,"log_time":1665023029,"user_name":"Applause","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":11662911,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":126743,"toughness":461939,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":106433,"toughness":422861,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":106514,"toughness":308865,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":69318,"toughness":158596,"recovery":0}]},{"server_time":1665236942,"log_time":1665022897,"user_name":"Applause","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":14302347,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":125445,"toughness":253017,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":110520,"toughness":320782,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":86252,"toughness":287308,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":96129,"toughness":282007,"recovery":0}]},{"server_time":1665236942,"log_time":1665022620,"user_name":"Applause","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":14314718,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":125456,"toughness":436656,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":109351,"toughness":424148,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":114196,"toughness":474960,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":120070,"toughness":439698,"recovery":0}]},{"server_time":1665236942,"log_time":1665020456,"user_name":"Ki","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":13011328,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/villain_redhood.png","dps":123597,"toughness":312893,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":90199,"toughness":429711,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":94855,"toughness":335669,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":102287,"toughness":289749,"recovery":0}]},{"server_time":1665236942,"log_time":1665020402,"user_name":"哈撒ki","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":17250130,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":144440,"toughness":314543,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":103421,"toughness":343554,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":143681,"toughness":402410,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":104163,"toughness":373238,"recovery":0}]},{"server_time":1665236942,"log_time":1665020370,"user_name":"Ki","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":17215832,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":129855,"toughness":449183,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":125538,"toughness":467921,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":117182,"toughness":452550,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":122733,"toughness":463056,"recovery":0}]},{"server_time":1665236942,"log_time":1665020265,"user_name":"Ki","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11002147,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":125616,"toughness":386437,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":146732,"toughness":273835,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":96804,"toughness":295031,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":84474,"toughness":250836,"recovery":0}]},{"server_time":1665236942,"log_time":1665020242,"user_name":"爱追风的叶子","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":16634395,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":144570,"toughness":294097,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":103502,"toughness":467087,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":106123,"toughness":360477,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":142923,"toughness":401500,"recovery":0}]},{"server_time":1665236942,"log_time":1665020090,"user_name":"爱追风的叶子","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13150868,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":100228,"toughness":381186,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":120934,"toughness":321533,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":142522,"toughness":479040,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/knight_male.png","dps":108526,"toughness":280650,"recovery":0}]},{"server_time":1665236942,"log_time":1665020002,"user_name":"爱追风的叶子","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":17903529,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":136634,"toughness":514752,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":150646,"toughness":534625,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":131105,"toughness":535311,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":136265,"toughness":468577,"recovery":0}]},{"server_time":1665236942,"log_time":1665019692,"user_name":"Ki","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":12683180,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/villain_redhood.png","dps":122673,"toughness":321718,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":99287,"toughness":418634,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":95539,"toughness":282604,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":83908,"toughness":266889,"recovery":0}]},{"server_time":1665236942,"log_time":1665019600,"user_name":"Ki","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11330678,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":110703,"toughness":372943,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":145013,"toughness":247164,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":98221,"toughness":250196,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":99524,"toughness":310637,"recovery":0}]},{"server_time":1665236942,"log_time":1665019448,"user_name":"Ki","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":17434885,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":128440,"toughness":426905,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":131666,"toughness":450809,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":116943,"toughness":429234,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":123621,"toughness":394413,"recovery":0}]},{"server_time":1665236942,"log_time":1665017792,"user_name":"可爱小勇士","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":15856633,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":128565,"toughness":422614,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":123770,"toughness":406725,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":124185,"toughness":475225,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":112460,"toughness":357884,"recovery":0}]},{"server_time":1665236942,"log_time":1665017374,"user_name":"鬼魈","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":13056404,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/villain_redhood.png","dps":136847,"toughness":298908,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":94825,"toughness":476049,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":104543,"toughness":361626,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":106190,"toughness":281800,"recovery":0}]},{"server_time":1665236942,"log_time":1665017365,"user_name":"oegg","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13429587,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":99417,"toughness":353151,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":143535,"toughness":480336,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":128910,"toughness":347410,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":120364,"toughness":346333,"recovery":0}]},{"server_time":1665236942,"log_time":1665017200,"user_name":"鬼魈","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":12510781,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":98785,"toughness":419574,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":108210,"toughness":342558,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":127679,"toughness":448976,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":117297,"toughness":353182,"recovery":0}]},{"server_time":1665236942,"log_time":1665016961,"user_name":"鬼魈","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":19165765,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":137133,"toughness":543656,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":150266,"toughness":532579,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":132615,"toughness":506578,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":136349,"toughness":452546,"recovery":0}]},{"server_time":1665236942,"log_time":1665016513,"user_name":"金闪闪","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13205550,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":84464,"toughness":347810,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":119866,"toughness":334746,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":124557,"toughness":321055,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":106957,"toughness":301128,"recovery":0}]},{"server_time":1665236942,"log_time":1665016499,"user_name":"蒜蓉扇贝","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":10785807,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":126827,"toughness":348552,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":96023,"toughness":307856,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":144756,"toughness":270981,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":99668,"toughness":336545,"recovery":0}]},{"server_time":1665236942,"log_time":1665016463,"user_name":"柚柚","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13842345,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/knight_female.png","dps":99292,"toughness":343959,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":140187,"toughness":486022,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":110681,"toughness":374927,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":118197,"toughness":339999,"recovery":0}]},{"server_time":1665236942,"log_time":1665016417,"user_name":"金闪闪","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":17128670,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":133224,"toughness":401196,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":146553,"toughness":514323,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":127233,"toughness":468993,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":115588,"toughness":415274,"recovery":0}]},{"server_time":1665236942,"log_time":1665016352,"user_name":"柚柚","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":15972823,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":132683,"toughness":535238,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":148504,"toughness":507097,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":117546,"toughness":481112,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":130316,"toughness":502007,"recovery":0}]},{"server_time":1665236942,"log_time":1665016298,"user_name":"金闪闪","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15126234,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":140928,"toughness":247026,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":102295,"toughness":454545,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":104587,"toughness":327808,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":138909,"toughness":335592,"recovery":0}]},{"server_time":1665236942,"log_time":1665016296,"user_name":"xxxzuzae丶","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":7993070,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":91600,"toughness":431596,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":136852,"toughness":462008,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":100769,"toughness":276915,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/priestess.png","dps":106187,"toughness":347770,"recovery":0}]},{"server_time":1665236942,"log_time":1665016258,"user_name":"柚柚","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15001540,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":142619,"toughness":297514,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":104263,"toughness":474111,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":106582,"toughness":379666,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":140916,"toughness":381267,"recovery":0}]},{"server_time":1665236942,"log_time":1665016252,"user_name":"蒜蓉扇贝","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":14963833,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":128283,"toughness":470879,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":115918,"toughness":410596,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":123135,"toughness":436737,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":124733,"toughness":475181,"recovery":0}]},{"server_time":1665236942,"log_time":1665016195,"user_name":"xxxzuzae丶","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":10262319,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":108007,"toughness":349003,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":122417,"toughness":391994,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":116779,"toughness":408322,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":138093,"toughness":389974,"recovery":0}]},{"server_time":1665236942,"log_time":1665016097,"user_name":"xxxzuzae丶","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":14343357,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":132952,"toughness":242243,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":85486,"toughness":267638,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":97201,"toughness":281768,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":130704,"toughness":292907,"recovery":0}]},{"server_time":1665236942,"log_time":1665013021,"user_name":"kk桑","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":9313758,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":133472,"toughness":289800,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":82519,"toughness":294778,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":114546,"toughness":366248,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":96351,"toughness":372047,"recovery":0}]},{"server_time":1665236942,"log_time":1665012757,"user_name":"蒜蓉扇贝","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":14303227,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/villain_redhood.png","dps":125905,"toughness":291752,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":99612,"toughness":304498,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":85764,"toughness":465000,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":94690,"toughness":267144,"recovery":0}]},{"server_time":1665236942,"log_time":1665012591,"user_name":"kk桑","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":12798791,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":128932,"toughness":462380,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":109774,"toughness":423648,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":119020,"toughness":463235,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":107398,"toughness":433780,"recovery":0}]},{"server_time":1665236942,"log_time":1665012443,"user_name":"kk桑","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":8823515,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":127423,"toughness":530106,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":109401,"toughness":313074,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":111135,"toughness":450211,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":95602,"toughness":250581,"recovery":0}]},{"server_time":1665236942,"log_time":1665012433,"user_name":"oegg","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":12974038,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/villain_redhood.png","dps":138756,"toughness":323270,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":108486,"toughness":488467,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":119869,"toughness":375598,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":99889,"toughness":285196,"recovery":0}]},{"server_time":1665236942,"log_time":1665012246,"user_name":"oegg","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":16557986,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":140692,"toughness":548650,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":130059,"toughness":511375,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":143059,"toughness":520939,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":118780,"toughness":501200,"recovery":0}]},{"server_time":1665236942,"log_time":1664989514,"user_name":"大斜","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":19469614,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":136884,"toughness":515074,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":150501,"toughness":520275,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":130760,"toughness":503565,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":136335,"toughness":521302,"recovery":0}]},{"server_time":1665236942,"log_time":1664989391,"user_name":"大斜","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":9846931,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":119656,"toughness":562714,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/priestess.png","dps":98853,"toughness":461335,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":148468,"toughness":554861,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":118976,"toughness":362046,"recovery":0}]},{"server_time":1665236942,"log_time":1664988924,"user_name":"Siseysei","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":11527883,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":136012,"toughness":576993,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":103712,"toughness":371636,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":116528,"toughness":502325,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":102155,"toughness":248135,"recovery":0}]},{"server_time":1665236942,"log_time":1664988843,"user_name":"切克闹","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":13385034,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":125487,"toughness":418467,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":124465,"toughness":439664,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":102305,"toughness":394555,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":76163,"toughness":460772,"recovery":0}]},{"server_time":1665236942,"log_time":1664988745,"user_name":"Siseysei","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":14191718,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":132184,"toughness":512687,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":127521,"toughness":501442,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":124185,"toughness":478492,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":116686,"toughness":436838,"recovery":0}]},{"server_time":1665236942,"log_time":1664988642,"user_name":"Siseysei","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11828346,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/knight_male.png","dps":92047,"toughness":284900,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":117634,"toughness":417219,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":107777,"toughness":352324,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":110451,"toughness":349652,"recovery":0}]},{"server_time":1665236942,"log_time":1664988485,"user_name":"涩涩糖心可可小馒头","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":18531606,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":137258,"toughness":460248,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":136900,"toughness":480476,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":132615,"toughness":476217,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":151360,"toughness":470405,"recovery":0}]},{"server_time":1665236942,"log_time":1664988415,"user_name":"李知恩","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":5871516,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":141413,"toughness":265780,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":103448,"toughness":517510,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":96069,"toughness":365372,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":117603,"toughness":359100,"recovery":0}]},{"server_time":1665236942,"log_time":1664988400,"user_name":"涩涩糖心可可小馒头","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13425550,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":97993,"toughness":358365,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":144064,"toughness":413305,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":119670,"toughness":329032,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":128590,"toughness":308682,"recovery":0}]},{"server_time":1665236942,"log_time":1664988353,"user_name":"李知恩","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":13365564,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":113318,"toughness":508378,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":123759,"toughness":423414,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":121685,"toughness":485804,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":105169,"toughness":423376,"recovery":0}]},{"server_time":1665236942,"log_time":1664988271,"user_name":"切克闹","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":10622839,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":79129,"toughness":299845,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":108029,"toughness":364876,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":95228,"toughness":292244,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":99162,"toughness":315956,"recovery":0}]},{"server_time":1665236942,"log_time":1664987713,"user_name":"巨棍向西摇","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":10250705,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":146927,"toughness":284542,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":100282,"toughness":262741,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":136533,"toughness":329997,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":99532,"toughness":331289,"recovery":0}]},{"server_time":1665236942,"log_time":1664987621,"user_name":"巨棍向西摇","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":10459800,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":133248,"toughness":523696,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":105095,"toughness":354683,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":101329,"toughness":440809,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":79924,"toughness":197337,"recovery":0}]},{"server_time":1665236942,"log_time":1664987512,"user_name":"巨棍向西摇","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":13475183,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":131560,"toughness":472184,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":131552,"toughness":434848,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":127210,"toughness":444612,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":114513,"toughness":428298,"recovery":0}]},{"server_time":1665236942,"log_time":1664987337,"user_name":"哈撒ki","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":17681184,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":139577,"toughness":510369,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":144257,"toughness":556670,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":134965,"toughness":524042,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":120929,"toughness":517301,"recovery":0}]},{"server_time":1665236942,"log_time":1664987247,"user_name":"哈撒ki","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":10990619,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":111560,"toughness":537537,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":148967,"toughness":564190,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":121747,"toughness":389093,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/priestess.png","dps":111887,"toughness":465995,"recovery":0}]},{"server_time":1665236942,"log_time":1664986857,"user_name":"一刀999","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":17956262,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":130811,"toughness":483077,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/fire_harpy.png","dps":145887,"toughness":519414,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":112921,"toughness":426721,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":110443,"toughness":432975,"recovery":0}]},{"server_time":1665236942,"log_time":1664986791,"user_name":"夜白","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":14609037,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":138284,"toughness":302973,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":102672,"toughness":487280,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":100180,"toughness":379976,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":121574,"toughness":376748,"recovery":0}]},{"server_time":1665236942,"log_time":1664986758,"user_name":"一刀999","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":10218456,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":95720,"toughness":377701,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":101273,"toughness":318412,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":112473,"toughness":412451,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mad_scientist.png","dps":72083,"toughness":292073,"recovery":0}]},{"server_time":1665236942,"log_time":1664986671,"user_name":"夜白","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11902264,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":91044,"toughness":392140,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":117155,"toughness":437979,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":108709,"toughness":370443,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":116174,"toughness":346301,"recovery":0}]},{"server_time":1665236942,"log_time":1664986570,"user_name":"夜白","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":14177304,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":121706,"toughness":495029,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":137198,"toughness":563450,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":130231,"toughness":520694,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":114398,"toughness":498766,"recovery":0}]},{"server_time":1665236942,"log_time":1664986507,"user_name":"不解释OO","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":11679919,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":138307,"toughness":543658,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":99870,"toughness":357920,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":107338,"toughness":483638,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":102239,"toughness":217217,"recovery":0}]},{"server_time":1665236942,"log_time":1664986396,"user_name":"切克闹","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":12226728,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":118622,"toughness":241930,"recovery":14596},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":89446,"toughness":366036,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":91776,"toughness":326905,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":111747,"toughness":328914,"recovery":0}]},{"server_time":1665236942,"log_time":1664986377,"user_name":"不解释OO","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":14457108,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":125748,"toughness":515016,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":134283,"toughness":510091,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":109792,"toughness":465596,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":118017,"toughness":430367,"recovery":0}]},{"server_time":1665236942,"log_time":1664986308,"user_name":"可爱小勇士","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11797680,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":90844,"toughness":295526,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":119702,"toughness":392525,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":103294,"toughness":328871,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":101902,"toughness":283865,"recovery":0}]},{"server_time":1665236942,"log_time":1664986276,"user_name":"不解释OO","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":9670562,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":84206,"toughness":370343,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":106076,"toughness":326206,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":116505,"toughness":420789,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":93666,"toughness":320586,"recovery":0}]},{"server_time":1665236942,"log_time":1664986248,"user_name":"涩涩糖心可可小馒头","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15571759,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":144787,"toughness":260215,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":105512,"toughness":433322,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":108543,"toughness":342755,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":143592,"toughness":370035,"recovery":0}]},{"server_time":1665236942,"log_time":1664986213,"user_name":"可爱小勇士","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":13658883,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":136073,"toughness":238793,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":132401,"toughness":367474,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":98627,"toughness":321020,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":95771,"toughness":362741,"recovery":0}]},{"server_time":1665236942,"log_time":1664986059,"user_name":"Freya","boss":{"name":"改良疯狂熊猫MK-三型","level":83,"elemental_type_cn":"土"},"damage":11312598,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/alpaca_girl.png","dps":137925,"toughness":536348,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":105420,"toughness":371190,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":118238,"toughness":472853,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/innuit.png","dps":107015,"toughness":224176,"recovery":0}]},{"server_time":1665236942,"log_time":1664986016,"user_name":"xx","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":12484415,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":120968,"toughness":451198,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":122354,"toughness":446633,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":118842,"toughness":471245,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":106386,"toughness":450710,"recovery":0}]},{"server_time":1665236942,"log_time":1664985926,"user_name":"DLan","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":18031848,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":139405,"toughness":466341,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":120020,"toughness":445454,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":133310,"toughness":469973,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":130848,"toughness":516183,"recovery":0}]},{"server_time":1665236942,"log_time":1664985925,"user_name":"不解释pp々","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":13458136,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":85472,"toughness":359535,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":140539,"toughness":458470,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":112656,"toughness":338566,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/knight_female.png","dps":101328,"toughness":307768,"recovery":0}]},{"server_time":1665236942,"log_time":1664985913,"user_name":"xx","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":11782726,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":92865,"toughness":361340,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":99904,"toughness":305187,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":118113,"toughness":404783,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":107360,"toughness":333370,"recovery":0}]},{"server_time":1665236942,"log_time":1664985817,"user_name":"不解释pp々","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":16140782,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":125491,"toughness":498839,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":141942,"toughness":510609,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":117521,"toughness":504968,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":127669,"toughness":505978,"recovery":0}]},{"server_time":1665236942,"log_time":1664985797,"user_name":"Freya","boss":{"name":"创始人艾芙芭","level":83,"elemental_type_cn":"虚"},"damage":16161692,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/demon_ceo.png","dps":124832,"toughness":468173,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/invader_knight.png","dps":141183,"toughness":507465,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/sheep_girl.png","dps":104906,"toughness":468575,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lifeguard_yuze.png","dps":124733,"toughness":424253,"recovery":0}]},{"server_time":1665236942,"log_time":1664985772,"user_name":"DLan","boss":{"name":"妖精","level":83,"elemental_type_cn":"光"},"damage":12941188,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":91801,"toughness":360582,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/white_druid.png","dps":126710,"toughness":358209,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/future_knight.png","dps":114522,"toughness":350934,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":112469,"toughness":336504,"recovery":0}]},{"server_time":1665236942,"log_time":1664985759,"user_name":"xx","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":13171563,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":141023,"toughness":256958,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":98862,"toughness":389699,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":98453,"toughness":332158,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":116462,"toughness":359489,"recovery":0}]},{"server_time":1665236942,"log_time":1664985732,"user_name":"不解释pp々","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15559987,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":142619,"toughness":298574,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":140313,"toughness":397118,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":103936,"toughness":479709,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":103824,"toughness":401510,"recovery":0}]},{"server_time":1665236942,"log_time":1664985702,"user_name":"Freya","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15202621,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":141882,"toughness":251795,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/eight_tail.png","dps":98164,"toughness":309450,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/lady_thief.png","dps":102630,"toughness":345431,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":138907,"toughness":368668,"recovery":0}]},{"server_time":1665236942,"log_time":1664985678,"user_name":"DLan","boss":{"name":"愤怒的牛头人","level":83,"elemental_type_cn":"火"},"damage":15146025,"role_list":[{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/garam.png","dps":144266,"toughness":262381,"recovery":15799},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/kamael.png","dps":107035,"toughness":420925,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/dancing_archer.png","dps":105994,"toughness":324304,"recovery":0},{"icon":"https://l1-prod-patch-snake.bilibiligame.net/resources/242/bigfunAssets/103/portraits/mercenary.png","dps":142611,"toughness":330270,"recovery":0}]}],"has_next_page":0,"current_page_num":1}
                // console.log(oneDataJsonStr);
                if (oneDataJson['code'] == 0) {
                    for (let ii in oneDataJson.data) {
                        let userName = oneDataJson.data[ii].user_name;
                        for (let iii in oneDataJson.data[ii].damage_list) {
                            let round = oneDataJson.data[ii].damage_list[iii].round;
                            let is_kill = oneDataJson.data[ii].damage_list[iii].is_kill;
                            let bossName = oneDataJson.data[ii].damage_list[iii].boss_name;
                            let damage = oneDataJson.data[ii].damage_list[iii].damage;
                            let logTime = oneDataJson.data[ii].damage_list[iii].log_time;
                            if (!(bossName in bossData)) {
                                bossData[bossName] = {};
                            }
                            if (Number(is_kill) == 0) {
                                if (Number(round) < reqUrlJson.minBossRound) {
                                    //不足83级别
                                    continue;
                                }
                                if (!(userName in bossData[bossName])) {
                                    bossData[bossName][userName] = {
                                        userName: userName,
                                        max: 0,
                                        count: 0,
                                        damage: 0,
                                        kill: 0
                                    };
                                }
                                if (damage > bossData[bossName][userName].max) {
                                    bossData[bossName][userName].max = damage;
                                    bossData[bossName][userName].roleList = roleList[`${userName}_${logTime}`];
                                }
                                bossData[bossName][userName].count += 1;
                                bossData[bossName][userName].damage += damage;

                            } else {
                                //尾刀
                                if (!(userName in bossData[bossName])) {
                                    bossData[bossName][userName] = {
                                        userName: userName,
                                        max: 0,
                                        count: 0,
                                        damage: 0,
                                        kill: 0
                                    };
                                }
                                bossData[bossName][userName].kill += 1;
                            }

                        }
                    }


                } else {
                    continue;
                }
            }

            //{bossName:[]}
            let sortKillArray = {};
            for (let bossName in bossData) {

                for (let userName in bossData[bossName]) {
                    if (!(userName in sortKillArray)) {
                        sortKillArray[userName] = 0;
                    }
                    sortKillArray[userName] += bossData[bossName][userName].kill;
                }
            }
            /* boss榜单排名 平均伤害 和 最高伤害 */
            // [{bossName:[{userName:xx,"max":xx}]}]
            let maxBossData = {};

            for (let bossName in bossData) {
                let bossMax = Object.keys(bossData[bossName]).sort((a, b) => {
                    return bossData[bossName][a].max - bossData[bossName][b].max
                }).reverse();
                maxBossData[bossName] = bossMax;
            }

            let avgBossData = {};
            for (let bossName in bossData) {
                let bossAvg = Object.keys(bossData[bossName]).sort((a, b) => {
                    return (bossData[bossName][a].count != 0 ? (bossData[bossName][a].damage / bossData[bossName][a].count) : 0) - (bossData[bossName][b].count != 0 ? (bossData[bossName][b].damage / bossData[bossName][b].count) : 0)
                }).reverse()
                avgBossData[bossName] = bossAvg;
            }

            let killBossData = [];
            let bosskill = Object.keys(sortKillArray).sort((a, b) => {
                return sortKillArray[b] - sortKillArray[a]
            });
            for (let i in bosskill) {
                killBossData.push({"userName": bosskill[i], "kill": sortKillArray[bosskill[i]]});
            }
            res.render("statisticTable", {
                "bossData": bossData,
                "maxBossData": maxBossData,
                "avgBossData": avgBossData,
                "killBossData": killBossData,
                "minBossRound": reqUrlJson.minBossRound
            });

        } else {
            res.render("errorCenter", {"msg": "获取数据失败"});
            return;
        }

    });
});

router.get("/damage/:entCode", function (req, res, next) {
    co(function* () {
        req.body = Object.assign(req.body, req.query);
        req.body.entCode = req.params.entCode;
        let json = {};
        let dateJson = {};
        try {
            let json1 = fs.readFileSync(fileName, "utf-8");
            dateJson = JSON.parse(json1);
        } catch (e) {
            loggerError.error("statistic", e);
        }
        let reqUrlJson = {};
        try {
            reqUrlJson = JSON.parse(fs.readFileSync(reqUrlFileName, "utf-8"));
        } catch (e) {
            loggerError.error("statistic", e);
        }

        if (!(req.body.entCode in dateJson)) {
            res.render("errorCenter", {msg: "无该工会"});
            return;
        }
        json = dateJson[req.body.entCode];

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let result = yield new Promise((resolved1, rejected1) => {
            defendBaseInfo(json, resolved1, rejected1);
        });
        if (result == "error") {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        } else {
            dateJson[req.body.entCode] = result;
            json = result;
            fs.writeFileSync(fileName, JSON.stringify(dateJson));
        }

        const options = {
            hostname: reqUrlJson.hostName,
            port: 443,
            path: reqUrlJson.statisticsUrl,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                "Cookie": json.cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36"
            },
            key: "",
            cert: ""
        };
        let httpresult = yield new Promise((resolved, rejected) => {
            var req = https.request(options, function (res) {
                res.setEncoding('utf8');
                let data = "";
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', () => {
                    resolved(data);
                });
            });
            req.on('error', function (e) {
                console.log('problem with request: ' + e.message);
                resolved("ok")
            });
            req.write("");
            req.end();
        });
        const resJson = JSON.parse(httpresult);
        if (resJson['code'] == 0) {
            let yRange = [];
            // 计算总刀数
            let name2Wx = {};
            for (let key in json.mem2WX) {
                name2Wx[json.mem2WX[key].name] = json.mem2WX[key].wxName;
            }

            let userData = {};
            // bossData:{"bossName":{"userName":{max:"",count:"",damage:""}}}
            let bossData = {};

            for (let i in resJson.data) {
                let userName = resJson.data[i].user_name;
                let damage = resJson.data[i].damage;
                let bossName = resJson.data[i].boss.name;
                let bossLevel = resJson.data[i].boss.level;
                if (!(userName in userData)) {
                    userData[userName] = {
                        userName: userName,
                        wxName: name2Wx[userName] ? name2Wx[userName] : userName,
                        bossName: {},
                        total: 0,
                        totalDamage: 0
                    };
                }
                if (!(bossName in userData[userName].bossName)) {
                    userData[userName].bossName[bossName] = {
                        "count": 0,
                        "damage": 0
                    }
                }
                userData[userName].total += 1;
                userData[userName].bossName[bossName] = {
                    "count": userData[userName].bossName[bossName].count + 1,
                    "damage": userData[userName].bossName[bossName].damage + Number(damage)
                }

                userData[userName].totalDamage += Number(damage);

                //计算83级 人员伤害排名
                if (!(bossName in bossData)) {
                    bossData[bossName] = {};
                }

                if (bossLevel == reqUrlJson.maxBossLevel) {
                    if (!(userName in bossData[bossName])) {
                        bossData[bossName][userName] = {
                            max: 0,
                            count: 0,
                            damage: 0
                        };
                    }
                    if (damage > bossData[bossName][userName].max) {
                        bossData[bossName][userName].max = damage;
                    }
                    bossData[bossName][userName].count += 1;
                    bossData[bossName][userName].damage += damage;
                }

            }

            //根据伤害排序
            let aakey = Object.keys(userData).sort((a, b) => {
                return userData[a].totalDamage - userData[b].totalDamage
            })

            /* 总伤害 和 总刀数排名*/
            let sortArray = [];
            for (let i in aakey) {
                sortArray.push(userData[aakey[i]])
            }
            let bossCategory = {};
            for (let i in sortArray) {
                let bossName = sortArray[i].bossName;
                let keys = Object.keys(bossName);
                for (let ii in keys) {
                    let key = keys[ii];
                    if (!(key in bossCategory)) {
                        bossCategory[key] = {
                            "damage": [],
                            "count": []
                        }
                    }
                }
                if (Object.keys(bossCategory).length == 4) {
                    break;
                }
            }
            for (let i in sortArray) {
                let bossName = sortArray[i].bossName;
                let keys = Object.keys(bossCategory);
                for (let ii in keys) {
                    let key = keys[ii];
                    bossCategory[key].damage.push(key in bossName ? bossName[key].damage : 0);
                    bossCategory[key].count.push(key in bossName ? bossName[key].count : 0);
                }
            }


            res.render("damage", {
                "bossCategory": bossCategory,
                "yAxis": aakey,

            });
        } else {
            res.render("errorCenter", {"msg": "获取工会成员失败"});
            return;
        }


    });

})

module.exports = router;
