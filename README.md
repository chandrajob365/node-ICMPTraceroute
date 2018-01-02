# node-ICMPTraceroute

[![NPM](https://nodei.co/npm/nodejs-traceroute.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/node-icmp-traceroute)

Node.js wrapper around traceroute process to get coordinates of received hops

## Install

  npm install --save node-icmp-traceroute

## Usage Example

```javascript
const ping = require('../traceroute')

ping.createSession().traceRoute('google.com', (err, data) => {
  if (err) {
    if (err.name === 'DNSError') console.log('err = ', err.message)
  } else {
    console.log('[Inside app] data.latitude = ', data.latitude,
    ' data.longitude = ', data.longitude,
    ' data.source = ', data.source,
    ' data.target = ', data.target,
    ' status = ', data.status)
  }
})

```
# Possible enhancements
- Support for IP address as input to traceroute
- IPv6 support
