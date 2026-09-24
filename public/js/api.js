// Thin REST client for the plugin's own API, mounted at
// /plugins/signalk-m510e-connector by the Signal K server.
const BASE = '/plugins/signalk-m510e-connector';

async function request(path, options) {
  const opts = options || {};
  const res = await fetch(BASE + path, { method: opts.method || 'GET' });
  var data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    var message = (data && data.error) || (res.status + ' ' + res.statusText);
    throw new Error(message);
  }
  return data;
}

var LIST_QUERY_KEYS = ['channelNr', 'from', 'to', 'direction', 'limit', 'offset'];

export const api = {
  getStatus: function () { return request('/status'); },
  listTransmissions: function (query) {
    var params = [];
    (query ? LIST_QUERY_KEYS : []).forEach(function (key) {
      var value = query[key];
      if (value !== undefined && value !== null && value !== '') {
        params.push(key + '=' + encodeURIComponent(value));
      }
    });
    return request('/transmissions' + (params.length ? '?' + params.join('&') : ''));
  },
  getTransmission: function (id) { return request('/transmissions/' + id); },
  audioUrl: function (id) { return BASE + '/transmissions/' + id + '/audio'; },
  // 501 when the optional Wyoming ASR service (asrUri) isn't configured;
  // 503 when configured but the service itself is unreachable/erroring.
  transcribe: function (id) { return request('/transmissions/' + id + '/transcribe', { method: 'POST' }); }
};
