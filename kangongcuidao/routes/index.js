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

const multipart = require('connect-multiparty');
const multipartMiddleware = multipart();
const fileName = `./sup/bejson.json`;
const reqUrlFileName = `./sup/reqUrl.json`;
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

        //更新组成员。
        // 先判断 时间决定是否需要进行更新  30分钟更新一次
        let now = new Date().getTime();
        if (Number(now) - Number(json.lastUpdateMemDate) > 30 * 60 * 1000) {
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
                json.lastUpdateMemDate = now;
                json.member = resJson.data.member;
                json.dateSize = resJson.data.date.length;
                now = new Date();
                let month = now.getMonth() + 1;
                let date = now.getDate();
                date = `${now.getFullYear()}-${month < 10 ? '0' + month : month}-${date < 10 ? '0' + date : date}`


                if (resJson.data.date[0] != date) {
                    checkUserInfo(req.body.entCode);
                }
                dateJson[req.body.entCode] = json;
                fs.writeFileSync(fileName, JSON.stringify(dateJson));
            } else {
                res.render("errorCenter", {"msg": "获取工会成员失败"});
                return;
            }
        } else {
            console.log(Number(now) - Number(json.lastUpdateMemDate), "时间不到 无需更新成员");
        }
        res.render("entCodePage", {"entCode": req.body.entCode});

    });
});

function checkUserInfo(entCode) {
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

    if (!(entCode in dateJson)) {
        return;
    }
    json = dateJson[entCode];

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
        let now = new Date().getTime();
        if (Number(now) - Number(json.lastUpdateMemDate) > 30 * 60 * 1000) {
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
                json.lastUpdateMemDate = now;
                json.member = resJson.data.member;
                json.dateSize = resJson.data.date.length;
                dateJson[req.body.entCode] = json;
                fs.writeFileSync(fileName, JSON.stringify(dateJson));
            } else {
                res.render("errorCenter", {"msg": "获取工会成员失败"});
                return;
            }
        } else {
            console.log(Number(now) - Number(json.lastUpdateMemDate), "时间不到 无需更新成员");
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
        let now = new Date().getTime();

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
        console.log(httpresult);
        if (resJson['code'] == 0) {
            let userData = {};
            for (let i in resJson.data) {
                userData[resJson.data[i].user_id] = resJson.data[i].damage_num
            }
            let noDataUser = '';
            for (let i in json.member) {
                let id = json.member[i].id;
                let name = json.member[i].name;
                let wxName = id in json.mem2WX ? json.mem2WX[id].wxName : "";
                if (!(id in userData)) {
                    noDataUser += `@${wxName ? wxName : name} 缺3刀; `;
                } else {
                    let num = userData[id];
                    num = 3 - Number(num);
                    if (num != 0) {
                        noDataUser += `@${wxName ? wxName : name} 缺${num}刀; `;
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
        let now = new Date().getTime();

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
            // 计算总刀数
            let memberNum = json.member.length;
            let dateSize = json.dateSize;
            let total = 3 * dateSize;

            let name2Wx = {};
            for (let key in json.mem2WX) {
                name2Wx[json.mem2WX[key].name] = json.mem2WX[key].wxName;
            }

            let userData = {};
            for (let i in resJson.data) {
                let userName = resJson.data[i].user_name;
                let damage = resJson.data[i].damage;
                let bossName = resJson.data[i].boss.name;
                if (!(userName in userData)) {
                    userData[userName] = {
                        userName: userName,
                        wxName: name2Wx[userName],
                        bossName: {},
                        total: 0
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
                // console.log(oneDataJsonStr);
                if (oneDataJson['code'] == 0) {
                    for (let ii in oneDataJson.data) {
                        let userName = oneDataJson.data[ii].user_name;
                        for (let iii in oneDataJson.data[ii].damage_list) {
                            let round = oneDataJson.data[ii].damage_list[iii].round;
                            let is_kill = oneDataJson.data[ii].damage_list[iii].is_kill;
                            let bossName = oneDataJson.data[ii].damage_list[iii].boss_name;
                            let damage = oneDataJson.data[ii].damage_list[iii].damage;
                            if (!(bossName in bossData)) {
                                bossData[bossName] = {};
                            }
                            if (Number(is_kill) == 0) {
                                if (Number(round) < 25) {
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
                "killBossData": killBossData
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
        let now = new Date().getTime();

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

                if (bossLevel == 83) {
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
