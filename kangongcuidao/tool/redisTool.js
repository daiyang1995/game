
/**
 * http://usejsdoc.org/

 */
'use strict';
const redis   = require('redis');
const co = require('co');
const redisConf = require('./../config/redisConf');
const log4js = require('log4js');
const loggerInfo = log4js.getLogger("default");
const loggerError = log4js.getLogger("error");

const client = redis.createClient(redisConf.port,redisConf.hostName,{auth_pass:redisConf.passWord});

client.on("error", (error) => {
    loggerError.error(error);
});
function redisTool() {
}
/**
 * callback 函数有2个回调参数,error和response, error表示操作过程中的错误提示值为null表示没有错误,response为获取到的值,null表示没有获取到数据
 */
redisTool.get = function(key , callback){
         client.get(key,callback);
};
/**
 * callback 函数有2个回调参数,error和response, error表示操作过程中的错误提示值为null表示没有错误,response为布尔值
 */
redisTool.set = function(key,value,callback){
        client.set(key, value, callback);
};
/**
 * callback 函数有2个回调参数,error和response, error表示操作过程中的错误提示值为null表示没有错误,response为布尔值
 */
redisTool.del = function(key,callback){
    client.del(key,callback);
};
/**
 * 将键存储的值加上整数increment
 */
redisTool.incrby = function(key, increment,callback){
    client.incrby(key, increment,callback);
};
/**
 * 将键存储的值减去整数increment
 */
redisTool.decrby  =function(key, increment,callback){
    decrby(key, increment,callback);
};
/**
 * 判断存不存在 callback error和response  键存在，response返回1，否则返回0
 */
redisTool.exists = function(key, callback){
   client.exists(key, callback);
};
/**
 * expire      设置一个key的过期的秒数
 */
redisTool.expire= function(key, seconds,callback){
    client.expire(key, seconds,callback);
};
/**
 * 哈希数据类型, 第一个参数为KEY名称,第二个为需要设置的字段KEY,第三个为值,第四个参数为回调参数,内容和set一致
 */
redisTool.hset = function(hashkey,field,value,callback){
    client.hset(hashkey,field,value,callback);
};
/**
 * 哈希数据类型, 第一个参数为KEY名称,后面的参数为不固定参数,数据格式是 key,value ,key, value1
 */
redisTool.hmset = function(hashkey,field,value,key,value1,callback){
    client.hmset(hashkey,field,value,key,value1, callback);
};
/**
 * 获取hash数据中的某一个字段值
 */
redisTool.hget = function(hashkey,field,callback){
    client.hget(hashkey,field,callback);
};
/**
 * 获取hash数据种所有的数据,包括字段与值
 */
redisTool.hgetall =function(hashkey,callback){
    client.hgetall(hashkey,callback);
};


module.exports = redisTool;
