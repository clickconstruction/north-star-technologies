(function () {
  var doc = document.documentElement;

  // Year in the footer.
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Phone menu.
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      doc.classList.toggle('nav-open', open);
    };
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  if (!('IntersectionObserver' in window)) return;

  // Sections ease in once as they enter the screen.
  var reveal = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          reveal.unobserve(en.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px' }
  );
  // Only what starts below the screen is hidden, and only by this script, so a page without it shows everything.
  document.querySelectorAll('.reveal').forEach(function (el) {
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.classList.add('pre');
    reveal.observe(el);
  });

  // The menu marks the section on screen.
  var links = {};
  document.querySelectorAll('[data-nav]').forEach(function (a) {
    links[a.getAttribute('data-nav')] = a;
  });
  var spy = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        var a = links[en.target.id];
        if (!a || !en.isIntersecting) return;
        Object.keys(links).forEach(function (k) {
          links[k].removeAttribute('aria-current');
        });
        a.setAttribute('aria-current', 'true');
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  Object.keys(links).forEach(function (id) {
    var sec = document.getElementById(id);
    if (sec) spy.observe(sec);
  });
})();
