var sourceToolbar = document.getElementById('source-toolbar');
document.querySelectorAll(".tab[data-panel]").forEach(function (tab) {
  tab.addEventListener("click", function () {
    var panel = tab.dataset.panel;
    document.querySelectorAll(".tab[data-panel]").forEach(function (t) {
      t.classList.remove("active");
    });
    tab.classList.add("active");
    if (panel === "code") {
      editorView.style.display = "flex";
      configView.classList.remove("visible");
      if (sourceToolbar) sourceToolbar.style.display = "";
    } else {
      editorView.style.display = "none";
      configView.classList.add("visible");
      if (sourceToolbar) sourceToolbar.style.display = "none";
      refreshAllColorUIs();
    }
  });
});
