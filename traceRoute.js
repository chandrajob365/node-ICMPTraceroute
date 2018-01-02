const raw = require('raw-socket')
const util = require('util')
const events = require('events')
const fetch = require('node-fetch')
const DNS = require('dns')
const protocol = raw.Protocol.ICMP
const addressFamily = raw.AddressFamily.IPv4
const level = raw.SocketLevel.IPPROTO_IP
const packetSize = 16
function Session () {
  this.defaultTTL = 64
  this.timeout = 2000
  this.reqs = {}
  this.sessionId = Math.floor(process.pid % 65535)
  this.nextId = 1
  this.reqs = {}
  this.reqsPending = 0
  this.socket = null
  this.source = ''
  this.getSocket()
}

util.inherits(Session, events.EventEmitter)

Session.prototype.getSocket = function () {
  if (this.socket) {
    return this.socket
  }
  let me = this
  this.socket = raw.createSocket({
    addressFamily: addressFamily,
    protocol: protocol
  })
  this.socket.on('message', this.onSocketMessage.bind(me))
  this.setTTL(this.defaultTTL)
  return this.socket
}

Session.prototype.setTTL = function (ttl) {
  this.getSocket().setOption(level, raw.SocketOption.IP_TTL, ttl)
}

Session.prototype.generateId = function () {
  this.nextId++
  while (1) {
    if (this.nextId > 65535) this.nextId = 1
    if (this.reqs[this.nextId]) this.nextId++
    else {
      return this.nextId
    }
  }
}

Session.prototype.toBuffer = function (req) {
  let buffer = Buffer.alloc(packetSize)
  let type = 8
  let code = 0
  buffer.writeUInt8(type, 0)
  buffer.writeUInt8(code, 1)
  buffer.writeUInt16BE(0, 2)
  buffer.writeUInt16BE(this.sessionId, 4)
  buffer.writeUInt16BE(req.id, 6)
  raw.writeChecksum(buffer, 2, raw.createChecksum(buffer))
  return buffer
}

Session.prototype.onBeforeSocketSend = function (req) {
  this.setTTL(req.ttl)
}

Session.prototype.onSocketSend = function (req, error, byte) {
  if (error) {
    this.reqRemove(req.id)
    req.callback(error, req.target)
  } else {
    let me = this
    req.timer = setTimeout(this.onTimeout.bind(me, req), req.timeout)
  }
}

Session.prototype.onTimeout = function (req) {
  this.reqRemove(req.id)
  req.callback(new RequestTimedOutError('Request timed out'), req.target)
}

Session.prototype.send = function (req) {
  let me = this
  let buffer = req.buffer
  this.getSocket().send(buffer, 0, buffer.length, req.target,
    this.onBeforeSocketSend.bind(me, req),
    this.onSocketSend.bind(me, req))
}

Session.prototype.fromBuffer = function (buffer) {
  let resType = Buffer.alloc(1)
  let resCode = Buffer.alloc(1)
  let reqIdentifier = Buffer.alloc(2)
  let reqSeq = Buffer.alloc(2)
  let resICMPOffset = 20
  resType = Buffer.alloc(1)
  buffer.copy(resType, 0, resICMPOffset, resICMPOffset + 1)
  if (resType.readUInt8() === 0) {
    buffer.copy(reqIdentifier, 0, resICMPOffset + 4, resICMPOffset + 4 + 2)
    buffer.copy(reqSeq, 0, resICMPOffset + 4 + 2, resICMPOffset + 4 + 2 + 2)
  } else {
    buffer.copy(resCode, 0, resICMPOffset + 1, resICMPOffset + 2)
    let reqICMPOffset = 1 + 1 + 2 + 4 + 20 // 1 resType, 1 resCode, 2 resChecksum, (2 resIdentifier + 2 resSeq), 20 IP
    buffer.copy(reqIdentifier, 0, resICMPOffset + reqICMPOffset + 4, resICMPOffset + reqICMPOffset + 4 + 2)
    buffer.copy(reqSeq, 0, resICMPOffset + reqICMPOffset + 4 + 2, resICMPOffset + reqICMPOffset + 4 + 2 + 2)
  }

  if (reqIdentifier.readUInt16BE() !== this.sessionId) {
    return
  }
  let req = this.reqs[reqSeq.readUInt16BE()]
  if (req) {
    req.type = resType.readUInt8()
    req.code = resCode.readUInt8()
    return req
  } else {
    return null
  }
}

Session.prototype.onSocketMessage = function (buffer, source) {
  var req = this.fromBuffer(buffer)
  if (req) {
    this.reqRemove(req.id)
    if (req.type === 0) {
      req.callback(null)
    } else if (req.type === 3) {
      req.callback(new DestinationUnreachableError(source))
    } else if (req.type === 4) {
      req.callback(new SourceQuenchError(source))
    } else if (req.type === 5) {
      req.callback(new RedirectReceivedError(source))
    } else if (req.type === 11) {
      req.callback(new TimeExceededError(source))
    } else {
      req.callback(new Error('Unknown response type ' + req.type +
        '(source = ' + source + ')'))
    }
  }
}

Session.prototype.reqRemove = function (reqId) {
  let req = this.reqs[reqId]
  if (req) {
    clearTimeout(req.timer)
    delete req.timer
    delete this.reqs[req.id]
    this.reqsPending--
  }
  return req
}
Session.prototype.reqQueue = function (req) {
  req.buffer = this.toBuffer(req)
  this.reqs[req.id] = req
  this.reqsPending++
  this.send(req)
  return this
}

function RequestTimedOutError () {
  this.name = 'RequestTimedOutError'
  this.message = 'Request timed out'
}
util.inherits(RequestTimedOutError, Error)

function SourceQuenchError (source) {
  this.name = 'SourceQuenchError'
  this.message = 'Source quench (source=' + source + ')'
  this.source = source
}
util.inherits(SourceQuenchError, Error)

function RedirectReceivedError (source) {
  this.name = 'RedirectReceivedError'
  this.message = 'Redirect received (source=' + source + ')'
  this.source = source
}
util.inherits(RedirectReceivedError, Error)

function DestinationUnreachableError (source) {
  this.name = 'DestinationUnreachableError'
  this.message = 'Destination unreachable (source = ' + source + ')'
  this.source = source
}
util.inherits(DestinationUnreachableError, Error)

function TimeExceededError (source) {
  this.name = 'TimeExceededError'
  this.message = 'Time exceeded (source = ' + source + ')'
  this.source = source
}
util.inherits(TimeExceededError, Error)

function DNSError () {
  this.name = 'DNSError'
  this.message = 'Please provide valid destination name'
}
util.inherits(DNSError, Error)

function FetchError (err) {
  this.type = err.name
  this.message = err.type
}
util.inherits(FetchError, Error)

Session.prototype.traceRouteCallback = function (trace, req, error) {
  let me = this
  this.getCoords.call(me, trace, req, error)
}

Session.prototype.getCoords = function (trace, req, error) {
  let source = error ? error.source : req.target
  fetch(`http://freegeoip.net/json/${source}`)
  .then(res => res.json())
  .then(res => {
    if (error && (req.ttl <= trace.ttl)) {
      trace.feedCallback(null, {
        latitude: res.latitude,
        longitude: res.longitude,
        source: source,
        target: req.target,
        status: 'inprogress'
      })
      this.next(trace, req)
    } else {
      trace.feedCallback(null, {
        latitude: res.latitude,
        longitude: res.longitude,
        source: source,
        target: req.target,
        status: 'done'
      })
    }
  })
  .catch(err => {
    if (error && (req.ttl <= trace.ttl)) {
      trace.feedCallback(new FetchError(err))
      this.next(trace, req)
    }
  })
}

Session.prototype.next = function (trace, req) {
  req.ttl++
  req.id = this.generateId()
  this.reqQueue(req)
}

Session.prototype.traceRoute = function (target, feedCallback) {
  this.resolveDNS(target, (err, IP) => {
    if (err) {
      feedCallback(err)
    } else {
      let me = this
      let startTTL = 1
      let id = this.generateId()
      const trace = {
        feedCallback: feedCallback,
        ttl: this.defaultTTL,
        timeouts: 0
      }
      const req = {
        id: id,
        timeout: this.timeout,
        ttl: startTTL,
        target: IP
      }
      req.callback = me.traceRouteCallback.bind(me, trace, req)
      this.reqQueue(req)
      return this
    }
  })
}

Session.prototype.resolveDNS = function (target, DNScb) {
  DNS.resolve(target, (err, addresses) => {
    if (err) {
      DNScb(new DNSError())
    } else {
      DNScb(null, addresses[0])
    }
  })
}

exports.createSession = function () {
  return new Session()
}

exports.Session = Session
exports.TimeExceededError = TimeExceededError
