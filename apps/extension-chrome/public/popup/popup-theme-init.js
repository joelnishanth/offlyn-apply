(function(){
  var k='ofl-dark-mode';
  var h=new Date().getHours();
  var auto=h<7||h>=20;
  try{var p=localStorage.getItem(k);if(p==='dark'||(p===null&&auto))document.documentElement.classList.add('dark');}catch(e){}
})();
