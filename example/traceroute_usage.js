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
