function setMobilePanel(panel) {
  document.body.dataset.mobilePanel = panel;
}
setMobilePanel('code');

document.querySelectorAll(".tab[data-panel]").forEach(function (tab) {
  tab.addEventListener("click", function () {
    var panel = tab.dataset.panel;
    document.querySelectorAll(".tab[data-panel]").forEach(function (t) {
      t.classList.remove("active");
    });
    tab.classList.add("active");
    setMobilePanel(panel);
    if (panel === "preview") {
      return;
    }
    if (panel === "code") {
      editorView.style.display = "flex";
      configView.classList.remove("visible");
    } else {
      editorView.style.display = "none";
      configView.classList.add("visible");
      refreshAllColorUIs();
    }
  });
});
