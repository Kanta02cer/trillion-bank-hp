(function(){
'use strict';
function q(id){return document.getElementById(id)}
function n(id){var el=q(id),v=el?parseFloat(el.value):0;return isFinite(v)?v:0}
function yen(v){return v>0?'¥'+Math.round(v).toLocaleString('ja-JP'):'-'}
function count(v){return Math.round(v).toLocaleString('ja-JP')}
function scenario(mult){
  var visitors=n('arp-visitors'),inquiries=n('arp-inquiries'),line=n('arp-line');
  var traffic=n('arp-traffic-uplift')*mult/100,cvr=n('arp-cvr-uplift')*mult/100;
  var currentCvr=visitors>0?inquiries/visitors:0;
  var currentLineRate=visitors>0?line/visitors:0;
  var newVisitors=visitors*(1+traffic);
  var newCvr=currentCvr*(1+cvr);
  var newInquiries=newVisitors*newCvr;
  var newLine=newVisitors*currentLineRate*(1+cvr);
  var close=n('arp-close-rate')/100,order=n('arp-order-value'),margin=n('arp-margin')/100;
  var extraInquiries=Math.max(0,newInquiries-inquiries);
  var extraProfit=(close>0&&order>0&&margin>0)?extraInquiries*close*order*margin:0;
  return{visitors:newVisitors,inquiries:newInquiries,line:newLine,extraVisitors:newVisitors-visitors,extraInquiries:extraInquiries,extraLine:newLine-line,extraProfit:extraProfit};
}
function render(){
  var low=scenario(.6),base=scenario(1),high=scenario(1.4),fee=n('arp-fee');
  q('arp-extra-visitors').textContent='+'+count(base.extraVisitors);
  q('arp-extra-inquiries').textContent='+'+count(base.extraInquiries);
  q('arp-extra-line').textContent='+'+count(base.extraLine);
  q('arp-extra-profit').textContent=yen(base.extraProfit);
  var rows=[['Low',low],['Base',base],['High',high]];
  q('arp-scenario-body').innerHTML=rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+count(r[1].visitors)+'</td><td>'+count(r[1].inquiries)+'</td><td>+'+count(r[1].extraInquiries)+'</td><td>'+yen(r[1].extraProfit)+'</td></tr>'}).join('');
  if(base.extraProfit>0&&fee>0){var roi=(base.extraProfit-fee)/fee*100;q('arp-roi').textContent=(roi>=0?'+':'')+roi.toFixed(0)+'%';q('arp-roi-note').textContent='基準シナリオの追加粗利 ÷ 月額費用から算出した参考ROI。因果効果ではありません。';}
  else{q('arp-roi').textContent='-';q('arp-roi-note').textContent='受注率・平均受注額・粗利率・月額費用を入力すると参考ROIを表示します。';}
}
function bind(){['arp-visitors','arp-inquiries','arp-line','arp-fee','arp-close-rate','arp-order-value','arp-margin','arp-traffic-uplift','arp-cvr-uplift'].forEach(function(id){var el=q(id);if(el)el.addEventListener('input',render)});var demo=q('arp-demo');if(demo)demo.onclick=function(){q('arp-visitors').value=8000;q('arp-inquiries').value=64;q('arp-line').value=30;q('arp-fee').value=200000;q('arp-close-rate').value=18;q('arp-order-value').value=600000;q('arp-margin').value=55;q('arp-traffic-uplift').value=18;q('arp-cvr-uplift').value=12;render()};render();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
