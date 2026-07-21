(function () {
  'use strict';

  var sections = Array.from(document.querySelectorAll('[data-example-fragment]'));
  var inFlight = new Map();
  var observer;
  var hasExplicitIntent = false;

  function claimExplicitIntent() {
    hasExplicitIntent = true;
    if (observer) observer.disconnect();
  }

  function statusElement(section) { return section.querySelector('[data-example-status]'); }
  function loadButton(section) { return section.querySelector('[data-example-load]'); }
  function setStatus(section, message) {
    var status = statusElement(section);
    if (status) status.textContent = message;
  }
  function setState(section, state) {
    section.setAttribute('data-example-state', state);
    var button = loadButton(section);
    if (!button) return;
    button.hidden = state === 'loaded';
    button.setAttribute('aria-disabled', state === 'loading' ? 'true' : 'false');
    button.textContent = state === 'failed' ? 'Retry loading examples' : 'Load examples';
  }
  function sectionForKind(kind) {
    return sections.find(function (section) { return section.getAttribute('data-example-kind') === kind; });
  }
  function decodedHashId(hash) {
    try { return decodeURIComponent(String(hash || '').replace(/^#/, '')); }
    catch (_) { return ''; }
  }
  function aliasForId(id) {
    return Array.from(document.querySelectorAll('[data-example-alias]')).find(function (alias) { return alias.id === id; });
  }
  function canonicalAliasTarget(alias) {
    return alias ? (alias.getAttribute('data-example-canonical') || alias.id) : '';
  }
  function focusTarget(id) {
    var target = id ? document.getElementById(id) : null;
    if (!target) return false;
    if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
    return true;
  }
  function removeAliases(kind) {
    document.querySelectorAll('[data-example-alias][data-example-kind="' + kind + '"]').forEach(function (alias) { alias.remove(); });
  }
  function validatedFragment(text, kind, contentType) {
    var essence = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
    if (essence !== 'text/html') throw new Error('unexpected content type ' + (contentType || '(missing)'));
    var template = document.createElement('template');
    template.innerHTML = text;
    if (template.content.children.length !== 1) throw new Error('fragment must have exactly one root');
    var root = template.content.firstElementChild;
    if (!root || root.getAttribute('data-example-fragment-root') !== kind) throw new Error('fragment root does not match ' + kind);
    if (root.querySelector('script,iframe,object,embed,link[rel="stylesheet"]')) throw new Error('fragment contains active content');
    return document.importNode(root, true);
  }
  function loadSection(section) {
    var state = section.getAttribute('data-example-state');
    if (state === 'loaded') return Promise.resolve(section);
    if (inFlight.has(section)) return inFlight.get(section);
    var kind = section.getAttribute('data-example-kind');
    var url = section.getAttribute('data-example-fragment');
    if (!kind || !url) return Promise.reject(new Error('fragment metadata is incomplete'));
    var fragmentUrl;
    try {
      fragmentUrl = new URL(url, location.href);
      var expectedPath = new RegExp('^/examples/fragments/' + kind + '-[a-f0-9]{12}\\.html$');
      if (fragmentUrl.origin !== location.origin || fragmentUrl.search || fragmentUrl.hash || !expectedPath.test(fragmentUrl.pathname)) throw new Error('invalid example fragment URL');
    } catch (error) {
      setState(section, 'failed');
      setStatus(section, 'Could not load examples. Retry or open the complete standalone page.');
      return Promise.reject(error);
    }
    setState(section, 'loading');
    setStatus(section, 'Loading examples…');
    var promise = fetch(fragmentUrl.pathname, { credentials: 'same-origin', headers: { accept: 'text/html' } })
      .then(function (response) {
        if (response.status !== 200) throw new Error('request returned ' + response.status);
        var contentType = response.headers.get('content-type');
        return response.text().then(function (text) { return validatedFragment(text, kind, contentType); });
      })
      .then(function (root) {
        var content = section.querySelector('[data-example-content]');
        if (!content) throw new Error('fragment content target is missing');
        content.replaceChildren(root);
        removeAliases(kind);
        setState(section, 'loaded');
        setStatus(section, 'Examples loaded.');
        return section;
      })
      .catch(function (error) {
        setState(section, 'failed');
        setStatus(section, 'Could not load examples. Retry or open the complete standalone page.');
        throw error;
      })
      .finally(function () { inFlight.delete(section); });
    inFlight.set(section, promise);
    return promise;
  }
  function resolveStandaloneAlias() {
    var id = decodedHashId(location.hash);
    if (!id) return;
    var alias = aliasForId(id);
    var canonical = canonicalAliasTarget(alias);
    if (!canonical || !document.getElementById(canonical)) return;
    alias.remove();
    if (canonical !== id) history.replaceState(null, '', '#' + canonical);
    focusTarget(canonical);
  }

  if (typeof fetch !== 'function') {
    resolveStandaloneAlias();
    return;
  }

  sections.forEach(function (section) {
    var button = loadButton(section);
    if (button) {
      button.hidden = false;
      button.addEventListener('click', function () {
        claimExplicitIntent();
        loadSection(section).catch(function () {});
      });
    }
  });

  document.querySelectorAll('a[data-example-deferred]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var kind = link.getAttribute('data-example-deferred');
      var section = sectionForKind(kind);
      if (!section) return;
      event.preventDefault();
      claimExplicitIntent();
      var destination = new URL(link.href, document.baseURI);
      var requestedId = decodedHashId(destination.hash);
      var alias = aliasForId(requestedId);
      var canonical = canonicalAliasTarget(alias) || requestedId;
      loadSection(section).then(function () {
        if (!focusTarget(canonical)) throw new Error('loaded fragment does not contain ' + canonical);
        history.pushState(null, '', '#' + canonical);
      }).catch(function () { location.assign(link.href); });
    });
  });

  function resolveDeferredHash() {
    var initialId = decodedHashId(location.hash);
    if (!initialId) return;
    var initialAlias = aliasForId(initialId);
    if (!initialAlias) return;
    claimExplicitIntent();
    var initialKind = initialAlias.getAttribute('data-example-kind');
    var initialCanonical = canonicalAliasTarget(initialAlias);
    var initialSection = sectionForKind(initialKind);
    if (initialSection) {
      loadSection(initialSection).then(function () {
        if (!focusTarget(initialCanonical)) throw new Error('loaded fragment does not contain ' + initialCanonical);
        if (initialCanonical !== initialId) history.replaceState(null, '', '#' + initialCanonical);
      }).catch(function () {});
    } else {
      resolveStandaloneAlias();
    }
  }
  addEventListener('hashchange', resolveDeferredHash);
  resolveDeferredHash();

  if (!hasExplicitIntent && typeof IntersectionObserver === 'function') {
    try {
      observer = new IntersectionObserver(function (entries) {
        var candidate = entries.filter(function (entry) {
          return entry.isIntersecting && entry.target.getAttribute('data-example-state') === 'idle';
        }).sort(function (left, right) { return left.boundingClientRect.top - right.boundingClientRect.top; })[0];
        if (!candidate) return;
        // One near-viewport section is intent; adjacent deferred sections stay
        // explicit instead of cascading into an all-corpus background fetch.
        observer.disconnect();
        loadSection(candidate.target).catch(function () {});
      }, { rootMargin: '300px 0px' });
      sections.forEach(function (section) { observer.observe(section); });
    } catch (_) {
      // Explicit load buttons and standalone links remain available.
    }
  }
}());
