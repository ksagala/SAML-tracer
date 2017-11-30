// export SAMLTrace namespace to make ao. Request definitions available
var EXPORTED_SYMBOLS = ["SAMLTrace"];

if ("undefined" == typeof(SAMLTrace)) {
  var SAMLTrace = {};
};

SAMLTrace.b64inflate = function (data) {
  // Remove any whitespace in the base64-encoded data -- Shibboleth may insert
  // line feeds in the data.
  data = data.replace(/\s/g, '');

  if (data.length % 4 != 0) {
    dump('Warning: base64-encoded data is not a multiple of 4 bytes long.\n');
    return null;
  }

  if (data.length < 4) {
    dump('Warning: Too short base64-encoded data.\n');
    return null;
  }

  var decoded = atob(data);
  var inflated = pako.inflateRaw(decoded);
  return String.fromCharCode.apply(String, inflated);
};

SAMLTrace.bin2hex = function(s) {
  var i; var l; var n; var o = '';
  for (i = 0, l = s.length; i < l; i++) {
    n = s.charCodeAt(i).toString(16)
    o += n.length < 2 ? '0' + n : n
  }
  return o
};

SAMLTrace.prettifyXML = function(xmlstring) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(xmlstring, 'text/xml');

  function isEmptyElement(element) {
    var whitespace = new RegExp('^\\s*$');
    for (var child = element.firstChild; child != null; child = child.nextSibling) {
      if (child instanceof Text && whitespace.test(child.data)) {
        continue;
      }
      return false;
    }
    return true;
  }

  function isTextElement(element) {
    for (var child = element.firstChild; child != null; child = child.nextSibling) {
      if (child instanceof Text) {
        continue;
      }
      return false;
    }
    return true;
  }

  function xmlEntities(string) {
    string = string.replace('&', '&amp;', 'g');
    string = string.replace('"', '&quot;', 'g');
    string = string.replace("'", '&apos;', 'g');
    string = string.replace('<', '&lt;', 'g');
    string = string.replace('>', '&gt;', 'g');
    return string;
  }

  function prettifyElement(element, indentation) {
    var ret = indentation + '<' + element.nodeName;

    var attrIndent = indentation;
    while (attrIndent.length < ret.length) {
      attrIndent += ' ';
    }

    var attrs = element.attributes;

    for (var i = 0; i < attrs.length; i++) {
      var a = attrs.item(i);
      if (i > 0) {
        ret += '\n' + attrIndent;
      }
      ret += ' ' + a.nodeName + '="' + xmlEntities(a.value) + '"';
    }

    if (isEmptyElement(element)) {
      if (attrs.length > 1) {
        return ret + '\n' + attrIndent + ' />\n';
      } else if (attrs.length == 1) {
        return ret + ' />\n';
      } else {
        return ret + '/>\n';
      }
    }

    if (attrs.length > 1) {
      ret += '\n' + attrIndent + ' >';
    } else {
      ret += '>';
    }

    if (isTextElement(element)) {
      return ret + xmlEntities(element.textContent) + '</' + element.nodeName + '>\n';
    }

    ret += '\n';

    for (var child = element.firstElementChild; child != null; child = child.nextElementSibling) {
      ret += prettifyElement(child, indentation + '    ');
    }

    return ret + indentation + '</' + element.nodeName + '>\n';
  }

  return prettifyElement(doc.documentElement, '');
};

SAMLTrace.prettifyArtifact = function(artstring) {
    var artifact = window.atob(artstring);
    return 'Endpoint Index: ' + SAMLTrace.bin2hex(artifact.substr(2,2)) + '\n' +
      'Source ID: ' + SAMLTrace.bin2hex(artifact.substr(4,20));
};

SAMLTrace.UniqueRequestId = function(webRequestId, url) {
  this.webRequestId = webRequestId;
  this.url = url;
};
SAMLTrace.UniqueRequestId.prototype = {
  'create' : function(onCreated) {
    Hash.calculate(this.url).then(digest => onCreated("request-" + this.webRequestId + "-" + digest));
  }
};

SAMLTrace.Request = function(request, getResponse) {
  this.method = request.req.method;
  this.url = request.req.url;
  this.requestId = request.req.requestId;
  this.getResponse = getResponse;

  this.loadRequestHeaders(request);
  this.loadGET();
  this.loadPOSTData(request);
  this.parsePOST();
  this.loadSAML();
};
SAMLTrace.Request.prototype = {
  'getParameter' : function(name) {
    for (var i = 0; i < this.get.length; i++) {
      var p = this.get[i];
      if (p[0] == name) {
        return p[1];
      }
    }
    return null;
  },
  'postParameter' : function(name) {
    for (var i = 0; i < this.post.length; i++) {
      var p = this.post[i];
      if (p[0] == name) {
        return p[1];
      }
    }
    return null;
  },
  'loadRequestHeaders' : function(request) {
    this.requestHeaders = request.headers;
  },
  'loadResponse' : function() {
    this.response = this.getResponse();
    this.responseStatus = this.response.statusCode;
    this.responseStatusText = this.response.statusLine;
    this.responseHeaders = this.response.responseHeaders;
  },
  'loadGET' : function() {
    var r = new RegExp('[&;\?]');
    var elements = this.url.split(r);

    this.get = [];

    for (var i = 1; i < elements.length; i++) {
      var e = elements[i];
      var p = e.indexOf('=');
      var name, value;
      if (p == -1) {
        name = e;
        value = '';
      } else {
        name = e.substr(0, p);
        value = e.substr(p + 1);
      }

      name = name.replace('+', ' ');
      name = decodeURIComponent(name);
      value = value.replace('+', ' ');
      value = decodeURIComponent(value);
      this.get.push([name, value]);
    }
  },
  'loadPOSTData' : function(request) {
    this.postData = '';

    if (this.method != 'POST') {
      return;
    }

    this.postData = request.req.requestBody.formData;
  },
  'parsePOST' : function() {
    this.post = [];

    if (this.postData == null || this.postData === '') {
      return;
    }

    var keys = Object.keys(this.postData);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var propertyValues = this.postData[key];
      this.post.push([key, propertyValues[0]])
    }
  },
  'loadSAML' : function() {
    var msg = this.getParameter('SAMLRequest');
    if (msg == null) {
      msg = this.getParameter('SAMLResponse');
    }
    if (msg != null) {
      this.saml = SAMLTrace.b64inflate(msg);
      return;
    }

    if (msg == null) {
      msg = this.getParameter('SAMLart');
    }
    if (msg != null) {
      this.samlart = msg;
      return;
    }

    msg = this.postParameter('SAMLRequest');
    if (msg == null) {
      msg = this.postParameter('SAMLResponse');
    }
    if (msg != null) {
      msg = msg.replace(/\s/g, '');
      this.saml = atob(msg);
      return;
    }

    if (msg == null) {
      msg = this.postParameter('SAMLart');
    }
    if (msg != null) {
      this.samlart = msg;
      return;
    }

    this.saml = null;
  }
};

SAMLTrace.RequestItem = function(request) {
  this.request = request;

  this.availableTabs = ['HTTP'];
  if (this.request.get.length != 0 || this.request.post.length != 0) {
    this.availableTabs.push('Parameters');
  }
  if (this.request.saml != null || this.request.samlart != null) {
    this.availableTabs.push('SAML');
  }
};
SAMLTrace.RequestItem.prototype = {

  'showHTTP' : function(target) {
    var doc = target.ownerDocument;

    function addHeaderLine(h) {
      var name = doc.createElement('b');
      name.textContent = h.name;
      target.appendChild(name);
      target.appendChild(doc.createTextNode(': ' + h.value + '\n'));
    }

    var reqLine = doc.createElement('b');
    reqLine.textContent = this.request.method + ' ' + this.request.url + ' HTTP/1.1\n';
    target.appendChild(reqLine);
    this.request.requestHeaders.forEach(addHeaderLine);
    target.appendChild(doc.createTextNode('\n'));

    this.request.loadResponse();
    var respLine = doc.createElement('b');
    respLine.textContent = this.request.responseStatusText + "\n";
    target.appendChild(respLine);
    this.request.responseHeaders.forEach(addHeaderLine);
  },

  'showParameters' : function(target) {
    var doc = target.ownerDocument;

    function addParameters(name, parameters) {
      if (parameters.length == 0) {
        return;
      }
      var h = doc.createElement('b');
      h.textContent = name + '\n';
      target.appendChild(h);
      for (var i = 0; i < parameters.length; i++) {
        var p = parameters[i];
        var nameElement = doc.createElement('b');
        nameElement.textContent = p[0];
        target.appendChild(nameElement);
        target.appendChild(doc.createTextNode(': ' + p[1] + '\n'));
      }
    }

    addParameters('GET', this.request.get);
    addParameters('POST', this.request.post);
  },

  'showSAML' : function(target) {
    var doc = target.ownerDocument;
    if (this.request.saml) {
      var samlFormatted = SAMLTrace.prettifyXML(this.request.saml);
    } else {
      var samlFormatted = SAMLTrace.prettifyArtifact(this.request.samlart);
    }
    target.appendChild(doc.createTextNode(samlFormatted));
  },

  'showContent' : function(target, type) {
    target.innerText = "";
    switch (type) {
    case 'HTTP':
      this.showHTTP(target);
      break;
    case 'Parameters':
      this.showParameters(target);
      break;
    case 'SAML':
      this.showSAML(target);
      break;
    }
  },

  'addListItem' : function(target, showContentElement) {
    var methodLabel = document.createElement("label");
    methodLabel.setAttribute('class', 'request-method');
    methodLabel.setAttribute('value', this.request.method);
    methodLabel.innerText = this.request.method;

    var urlLabel = document.createElement("label");
    urlLabel.setAttribute('flex', '1');
    urlLabel.setAttribute('crop', 'end');
    urlLabel.setAttribute('class', 'request-url');
    urlLabel.setAttribute('value', this.request.url);
    urlLabel.innerText = this.request.url;

    var hbox = document.createElement("div");
    hbox.setAttribute('flex', '1');
    var uniqueRequestId = new SAMLTrace.UniqueRequestId(this.request.requestId, this.request.url);
    uniqueRequestId.create(id => hbox.setAttribute('id', id));
    hbox.setAttribute('class', 'list-row');
    hbox.appendChild(methodLabel);
    hbox.appendChild(urlLabel);

    if (this.request.saml || this.request.samlart) {
      var samlLogo = document.createElement("div");
      samlLogo.classList.add("saml-logo");
      hbox.appendChild(samlLogo);
    }

    hbox.requestItem = this;
    target.appendChild(hbox);
    return hbox;
  },
};

SAMLTrace.TraceWindow = function() {
  window.tracer = this;
  this.httpRequests = [];
  this.requests = [];
  this.autoScroll = true;
  this.filterResources = true;
};

SAMLTrace.TraceWindow.prototype = {
  'isRequestVisible' : function(request) {
    var contentTypeHeader = request.responseHeaders.filter(header => header.name.toLowerCase() === 'content-type');
    if (contentTypeHeader === null || contentTypeHeader.length === 0) {
      return true;
    }
    var type = contentTypeHeader[0].value;

    var i = type.indexOf(';');
    if (i != -1) {
      type = type.substr(0, i);
    }
    type = type.toLowerCase().trim();

    switch (type) {
    case 'application/ecmascript':
    case 'application/javascript':
    case 'application/ocsp-response':
    case 'application/vnd.google.safebrowsing-chunk':
    case 'application/vnd.google.safebrowsing-update':
    case 'application/x-javascript':
    case 'application/x-shockwave-flash':
    case 'image/gif':
    case 'image/jpg':
    case 'image/jpeg':
    case 'image/png':
    case 'image/vnd.microsoft.icon':
    case 'image/x-icon':
    case 'text/css':
    case 'text/ecmascript':
    case 'text/javascript':
    case 'text/x-content-security-policy':
      return false;
    default:
      return true;
    }
  },

  'addRequestItem' : function(request, getResponse) {
    var samlTracerRequest = new SAMLTrace.Request(request, getResponse);
    var item = new SAMLTrace.RequestItem(samlTracerRequest, showContentElement);
    this.requests.push(samlTracerRequest);

    var requestList = document.getElementById('request-list');
    var showContentElement = document.getElementById('request-info-content');
    var requestItemListElement = item.addListItem(requestList, showContentElement);

    requestItemListElement.addEventListener('click', e => {
      this.selectItemInList(requestItemListElement, requestList);
      this.showRequest(requestItemListElement.requestItem);
    }, false);

    if (this.autoScroll) {
      requestList.scrollTop = requestList.scrollHeight;
    }
  },

  'resetList' : function() {
    var listbox = document.getElementById('request-list');
    while (listbox.firstChild) {
      listbox.removeChild(listbox.firstChild);
    }

    this.updateStatusBar();
  },

  'clearRequests' : function() {
    this.requests = [];
    this.httpRequests = [];
    this.resetList();
    this.showRequest(null);
  },

  'setAutoscroll' : function(autoScroll) {
    this.autoScroll = autoScroll;
  },

  'setFilterResources' : function(filterResources) {
    this.filterResources = filterResources;
    this.updateStatusBar();
  },

  'updateStatusBar' : function() {
    var hiddenElementsString = "";
    if (this.filterResources) {
      hiddenElementsString = ` (${this.httpRequests.filter(req => !req.isVisible).length} hidden)`;
    }
    var status = `${this.httpRequests.length} requests received ${hiddenElementsString}`;
    var statusItem = document.getElementById('statuspanel');
    statusItem.innerText = status;
  },

  'saveNewRequest' : function(request) { // onBeforeRequest
    var uniqueRequestId = new SAMLTrace.UniqueRequestId(request.requestId, request.url);
    uniqueRequestId.create(id => {

      var isRedirected = function(requestId) {
        var parentRequest = this.tracer.httpRequests.find(r => r.req.requestId === requestId);
        if (parentRequest != null && parentRequest.res != null && parentRequest.res.statusCode === 302) {
          return true;
        }
        return false;
      }

      // The webRequest-API seems to keep the HTTP verbs which is correct in resepct to RFC 2616 but
      // differs from a typical browser behaviour which will usually change the POST to a GET. So do we here...
      // see: https://github.com/UNINETT/SAML-tracer/pull/23#issuecomment-345540591
      if (request.method === 'POST' && isRedirected(request.requestId)) {
        console.log(`Redirected 302-request '${id}' is a POST but is here changed to a GET to conform to browser behaviour...`);
        request.method = 'GET';
      }

      var entry = {
        id: id,
        req: request
      };
      this.tracer.httpRequests.push(entry);
    });
  },

  'attachHeadersToRequest' : function(request) { // onBeforeSendHeaders
    var uniqueRequestId = new SAMLTrace.UniqueRequestId(request.requestId, request.url);
    uniqueRequestId.create(id => {
      var entry = this.tracer.httpRequests.find(req => req.id === id);
      entry.headers = request.requestHeaders;

      this.tracer.addRequestItem(entry, () => entry.res);
      this.tracer.updateStatusBar();
    });
  },

  'attachResponseToRequest' : function(response) { // onHeadersReceived
    var uniqueRequestId = new SAMLTrace.UniqueRequestId(response.requestId, response.url);
    uniqueRequestId.create(id => {
      var index = this.tracer.httpRequests.findIndex(req => req.id === id);
      this.tracer.httpRequests[index].res = response;

      // layout update: apply style to item based on responseStatus
      var r = response.statusCode;
      var s;
      if (r<200) s='info';
      else if (r<300) s='ok';
      else if (r<400) s='redirect';
      else if (r<500) s='clerror';
      else if (r<600) s='srerror';
      else s='other';

      var removeClassByPrefix = function removeClassByPrefix(element, prefix) {
        var regex = new RegExp('\\b' + prefix + '(.*)?\\b', 'g');
        element.className = element.className.replace(regex, '');
        return element;
      }

      var requestDiv = document.getElementById(id);
      if (requestDiv !== null) {
        removeClassByPrefix(requestDiv, "request-");
        requestDiv.classList.add("request-" + s);

        var isVisible = this.tracer.isRequestVisible(response);
        if (!isVisible) {
          requestDiv.classList.add("isRessource");
        }
        
        this.tracer.httpRequests[index].isVisible = isVisible;
        this.tracer.updateStatusBar();
      }
      
      if (response.statusCode === 302) {
        let location = response.responseHeaders.find(header => header.name === "Location");
        console.log(`Redirecting request '${id}' to new location '${location.value}'...`);
        return {
          redirectUrl: location.value
        };
      }
    });
  },
  
  'selectTab' : function(name, containingElement) {
    var tab = containingElement.querySelector(`[href*=\\#${name}]`)
    this.selectItemInList(tab, containingElement);
  },

  'selectItemInList' : function(itemToBeSelected, containingElement) {
    // un-select previously selected items
    var previouslySelectedItems = containingElement.querySelectorAll(".selected");
    previouslySelectedItems.forEach(item => item.classList.remove("selected"));

    // select new item
    itemToBeSelected.classList.add("selected");
  },

  'showRequest' : function(requestItem) {
    var requestInfoContent = document.getElementById('request-info-content');
    if (requestItem === null) {
      requestInfoContent.innerText = "";
      return;
    }
    this.requestItem = requestItem;

    var requestInfoTabbox = document.getElementById('request-info-tabbox');
    requestInfoTabbox.innerText = "";
    for (var i = 0; i < requestItem.availableTabs.length; i++) {
      var name = requestItem.availableTabs[i];
      this.addRequestTab(name, requestInfoTabbox, requestInfoContent);
    }

    var lastSelectedTab = this.selectedTab;
    if (requestItem.availableTabs.find(tab => tab === this.selectedTab) === undefined) {
      lastSelectedTab = 'HTTP';
      this.selectedTab = lastSelectedTab;
    }
    this.selectTab(lastSelectedTab, requestInfoTabbox);
    this.showRequestContent(requestInfoContent, lastSelectedTab);
  },

  'addRequestTab' : function(name, requestInfoTabbox, requestInfoContent) {
    var tab = document.createElement('a');
    tab.setAttribute('class', 'tab');
    tab.setAttribute('href', '#' + name);
    tab.innerHTML = name;
    tab.addEventListener('click', e => {
      var tabName = e.target.hash.substr(1);
      this.selectTab(tabName, e.target.parentElement);
      this.showRequestContent(requestInfoContent, tabName);
      this.selectedTab = tabName;
    }, false);

    if (this.selectedTab === undefined) {
      tab.classList.add('selected');
      this.selectedTab = tab.href.split('#')[1];
    } 

    requestInfoTabbox.appendChild(tab);
  },

  'showRequestContent' : function(element, type) {
    if (this.requestItem == null) {
      /* No request selected. */
      return;
    }
    this.requestItem.showContent(element, type);
  }
};

SAMLTrace.TraceWindow.init = function() {
  var traceWindow = new SAMLTrace.TraceWindow();
  
  browser.webRequest.onBeforeRequest.addListener(
    traceWindow.saveNewRequest,
    {urls: ["<all_urls>"]},
    ["blocking", "requestBody"]
  );

  browser.webRequest.onBeforeSendHeaders.addListener(
    traceWindow.attachHeadersToRequest,
    {urls: ["<all_urls>"]},
    ["blocking", "requestHeaders"]
  );

  browser.webRequest.onHeadersReceived.addListener(
    traceWindow.attachResponseToRequest,
    {urls: ["<all_urls>"]},
    ["blocking", "responseHeaders"]
  );
};