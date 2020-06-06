var sip = require('../sip');

var transport = sip.makeTransport({}, function(m, remote) {
	console.log(sip.stringify(m));
});

