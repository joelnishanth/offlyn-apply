document.querySelectorAll('.faq-q').forEach(function(q) {
  q.addEventListener('click', function() {
    this.parentElement.classList.toggle('open');
  });
});
