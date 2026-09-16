/* RoastMe landing interactions — reveal-on-scroll, FAQ, newsletter, resend. */
(function () {
  "use strict";

  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function track(event, extra) {
    try {
      var body = JSON.stringify(Object.assign({ event: event }, extra || {}));
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true });
      }
    } catch (e) { /* analytics never breaks the page */ }
  }

  // Referral landing: ?ref=<roast_id>
  var ref = qs("ref");
  if (ref) {
    try { sessionStorage.setItem("roastme_ref", ref); } catch (e) {}
    var banner = document.getElementById("refBanner");
    if (banner) banner.classList.remove("hidden");
    track("ref_landing", { ref: ref });
  }
  track("page_view", ref ? { ref: ref } : {});

  // Reveal-on-scroll
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  // FAQ single-open
  var faqs = document.querySelectorAll(".faq-list details");
  faqs.forEach(function (d) {
    d.querySelector("summary").addEventListener("click", function () {
      faqs.forEach(function (o) { if (o !== d && o.open) o.removeAttribute("open"); });
    });
  });

  // Footer newsletter -> central signup store via /api/capture
  var newsForm = document.getElementById("newsForm");
  if (newsForm) {
    newsForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("newsEmail");
      var msg = document.getElementById("newsMsg");
      var email = (input.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = "That email looks fake. Even our roasts are more real.";
        return;
      }
      msg.textContent = "Joining…";
      fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok) {
          msg.textContent = "You're on the list. 🔥";
          input.value = "";
        } else if (res && res.error === "disposable_email") {
          msg.textContent = "Throwaway emails get roasted harder. Use a real one.";
        } else {
          msg.textContent = "Couldn't join right now — try again in a bit.";
        }
      }).catch(function () {
        msg.textContent = "Couldn't join right now — try again in a bit.";
      });
    });
  }

  // Lost-link recovery
  var resendForm = document.getElementById("resendForm");
  if (resendForm) {
    resendForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("resendEmail");
      var msg = document.getElementById("resendMsg");
      var email = (input.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = "That email looks fake. Even our roasts are more real.";
        return;
      }
      msg.textContent = "Checking…";
      track("resend_requested", {});
      fetch("/api/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.unlock_url) {
          msg.innerHTML = 'Found it. <a href="' + res.unlock_url.replace(/"/g, "") + '">Open your roast card →</a>';
        } else {
          msg.textContent = "If that email bought a roast, the link is on its way to your memory. (No purchase found.)";
        }
        input.value = "";
      }).catch(function () {
        msg.textContent = "Couldn't check right now — try again in a bit.";
      });
    });
  }
})();
