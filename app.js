//Variable global
const DB_NAME = 'formTB_db_v1';
const DB_VERSION = 2;
const STORE_USER = 'userInfo';
const STORE_MASTER = 'dataMaster';
const STORE_OPNAME = 'dataOpname';
let db = null;
let codeReader = null; // ZXing reader
let scannerStream = null;
let scannerRunning = false;
let tempFotoBlob = null; //foto
let confirmLock = false;
let _confirmPromise = null;
let _confirmResolve = null;
let currentMode = null; // 'EDIT' | 'NEW' | 'UNKNOWN' | null
let currentRecord = null; //master record loaded
let beepLocked = false; //bunyi scan


/* -------------------------
   IndexedDB Promisified
----------------------------*/
//init IndexedDB
function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const idb = ev.target.result;
      if (!idb.objectStoreNames.contains('dataFoto')) {
      idb.createObjectStore('dataFoto', { keyPath: 'id' }); 
      }
      if (!idb.objectStoreNames.contains(STORE_USER)) {
        idb.createObjectStore(STORE_USER, { keyPath: 'id' });
      }
      if (!idb.objectStoreNames.contains(STORE_MASTER)) {
        const s = idb.createObjectStore(STORE_MASTER, { keyPath: 'upc' });
        s.createIndex('article', 'article', { unique: false });
      }
      if (!idb.objectStoreNames.contains(STORE_OPNAME)) {
        const s = idb.createObjectStore(STORE_OPNAME, { keyPath: 'upc' });
        s.createIndex('article', 'article', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
//Baca Store indexedDB
function tx(storeName, mode='readonly'){
  const t = db.transaction([storeName], mode);
  return t.objectStore(storeName);
}
//=================
//====Helper=======
//=================
//User Info Helper
async function getUserInfo(){
  const store = tx(STORE_USER);
  return new Promise((res, rej) => {
    const r = store.get('me');
    r.onsuccess = ()=> res(r.result || null);
    r.onerror = ()=> rej(r.error);
  });
}
async function saveUserInfoToDB(obj){
  const store = tx(STORE_USER, 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put(Object.assign({ id:'me' }, obj));
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}

/* Master helpers */
async function clearMaster(){ // optional utility
  const store = tx(STORE_MASTER, 'readwrite');
  return new Promise((res, rej) => {
    const r = store.clear();
    r.onsuccess = ()=> res();
    r.onerror = ()=> rej(r.error);
  });
}
async function putMaster(record){
  const store = tx(STORE_MASTER, 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put(record);
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}
async function getMasterByUPC(upc){
  const store = tx(STORE_MASTER);
  return new Promise((res, rej) => {
    const r = store.get(upc);
    r.onsuccess = ()=> res(r.result || null);
    r.onerror = ()=> rej(r.error);
  });
}
async function getMasterByArticle(article){
  const store = tx(STORE_MASTER);
  return new Promise((res, rej) => {
    const idx = store.index('article');
    const r = idx.getAll(article);
    r.onsuccess = ()=> {
      const arr = r.result || [];
      res(arr.length? arr[0] : null);
    };
    r.onerror = ()=> rej(r.error);
  });
}

/* Opname helpers */
async function getOpnameByUPC(upc){
  const store = tx(STORE_OPNAME);
  return new Promise((res, rej)=>{
    const r = store.get(upc);
    r.onsuccess = ()=> res(r.result || null);
    r.onerror = ()=> rej(r.error);
  });
}
async function getOpnameByArticle(article){
  const store = tx(STORE_OPNAME);
  return new Promise((res, rej)=>{
    const idx = store.index('article');
    const r = idx.getAll(article);
    r.onsuccess = ()=> {
      const arr = r.result || [];
      res(arr.length? arr[0] : null);
    };
    r.onerror = ()=> rej(r.error);
  });
}
async function putOpname(rec){
  const store = tx(STORE_OPNAME, 'readwrite');
  return new Promise((res, rej)=>{
    const r = store.put(rec);
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}
async function getAllOpname(){
  const store = tx(STORE_OPNAME);
  return new Promise((res, rej)=>{
    const r = store.getAll();
    r.onsuccess = ()=> res(r.result || []);
    r.onerror = ()=> rej(r.error);
  });
}

//UI Helpers & init
function $(id){ return document.getElementById(id); }

//Format tanggal dan Waktu
function formatDate(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function formatTime(d){
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

//helper init
async function init(){
  await openDB();
  loadMasterFromZip();
  bindEvents();
  await initUserInfo();
  initHeaderTick();
}
document.addEventListener('DOMContentLoaded', init);


//deteksi ios
function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/* bind event listeners */
function bindEvents(){
  // --- DETEKSI IOS ---
  if (isIOS()) {
    // IOS → tampilkan tombol khusus
    $('btnShareWa').style.display = 'none';
    $('btnShareWaIOS').style.display = 'block';

    // Event tombol versi iOS
    $('btnShareWaIOS').addEventListener('click', shareToWhatsappIOS);

  } else {
    // Android / Windows / Mac
    $('btnShareWaIOS').style.display = 'none';
    $('btnShareWa').style.display = 'block';

    // Event tombol WA asli
    $('btnShareWa').addEventListener('click', shareToWhatsapp);
  }
  
  $('btnPou').addEventListener('click', () => {
  $('modalPou').style.display = "flex";
    });
  $('btnClosePou').addEventListener('click', () => {
  $('modalPou').style.display = "none";
    });
    //hapusDataMaster
  $('btnMaster').addEventListener('click', () => {
  $('modalMaster').style.display = "flex";
  $('confirmMasterDelete').value = "";
    });
  $('btnCloseMaster').addEventListener('click', () => {
  $('modalMaster').style.display = "none";
  });
  $('btnConfirmDeleteMaster').addEventListener('click', hapusDataMaster);
  //finish confirm
  $('btnFinish').addEventListener('click', () => {
  $('modalOnFinish').style.display = "flex";
  $('confirmOnFinish').value = "";
    });
  $('btnCloseOnFinish').addEventListener('click', () => {
  $('modalOnFinish').style.display = "none";
  });
  $('btnConfirmOnFinish').addEventListener('click', onFinish);
  //endfinish
  
  $('btnDownloadFoto').addEventListener('click', downloadAllPhotosZip);
  $('btnUserSave').addEventListener('click', onClickUserSave);
  $('btnUserClose').addEventListener('click', ()=> { closeUserModal(); });

  $('btnScan').addEventListener('click', openScannerModal);
  $('btnStopScan').addEventListener('click', stopScannerAndClose);

  $('inputUPC').addEventListener('keydown', async (e)=>{
    if(e.key === 'Enter') await doLookupFromInput();
  });

  $('btnSave').addEventListener('click', onClickSaveOpname);
  $('btnView').addEventListener('click', showViewModal);

  $('btnUpdateMaster').addEventListener('click', ()=> $('fileMaster').click());
  $('fileMaster').addEventListener('change', onFileMasterSelected);

  $('btnCloseView').addEventListener('click', ()=> $('modalView').classList.add('hidden'));
  $('btnExportCsv').addEventListener('click', exportOpnameCsv);
  // $('btnFinish').addEventListener('click', onFinish);
  $('btnHapusOpname').addEventListener('click', hapusSemuaOpname);
  $('btnExportXls').addEventListener('click', exportOpnameXls);
  $('inputFoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) {
    tempFotoBlob = null;
    return;
  }
  tempFotoBlob = await fileToBlob(file);
  // Tampilkan hint
  $('fotoHint').textContent = "Foto berhasil diambil ✔️";
  $('fotoHintBox').classList.remove('hidden');
  });
  $('btnCloseFoto').addEventListener('click', () => {
  $('modalFoto').classList.add('hidden');
  $('fotoPreview').src = "";
});
$('btnHapusFoto').addEventListener('click', () => {
  tempFotoBlob = null;
  $('inputFoto').value = "";
  $('fotoHintBox').classList.add('hidden');
  showAlert("info", "Foto dihapus.");
});
}

/* -------------------------
   User Info Modal
----------------------------*/
//init userInfo
async function initUserInfo(){
  const u = await getUserInfo();
  const today = new Date();
  $('userTanggal').value = formatDate(today);

  if(u){
    // prefill and show close button
    $('userNama').value = u.nama || '';
    $('userNip').value = u.nip || '';
    $('userAsal').value = u.toko_asal || '';
    $('userTujuan').value = u.toko_tujuan || '';
    $('btnUserClose').classList.remove('hidden');
  } else {
    $('btnUserClose').classList.add('hidden');
  }
  // always show modal on load
  $('modalUser').classList.remove('hidden');
  refreshHeader(); // in case user exists
}
//fungsi simpan userInfo
async function onClickUserSave(){
  const nama = $('userNama').value.trim();
  const nip = $('userNip').value.trim();
  const toko_asal = $('userAsal').value.trim();
  const toko_tujuan = $('userTujuan').value.trim();
  const tanggal = $('userTanggal').value.trim() || formatDate(new Date());
  if(!nama || !toko_asal || !toko_tujuan){
    showAlert('info', 'Isi Nama, Toko Asal, dan Toko Tujuan minimal.');
    return;
  }
  await saveUserInfoToDB({ nama, nip, toko_asal, toko_tujuan, tanggal });
  $('btnUserClose').classList.remove('hidden');
  showAlert('success', 'User info tersimpan');
  // keep modal visible but refresh header
  refreshHeader();
  $('modalUser').classList.add('hidden');
}
//fungsi tutup userInfo
function closeUserModal(){
  $('modalUser').classList.add('hidden');
}

/* -------------------------
   Header + Clock
----------------------------*/
//refreshHeader
async function refreshHeader(){
  const u = await getUserInfo();
  if(!u) return;
  $('txtRute').textContent = `FROM (${u.toko_asal}) TO (${u.toko_tujuan})`;
  $('txtPegawai').textContent = `${u.nama || '—'} | ${u.nip || '—'}`;
  const today = new Date();
  const hari = today.toLocaleDateString('id-ID', { weekday:'long' });
  $('txtTanggal').innerHTML = `${hari} | ${formatDate(today)} | <span id="clock">${formatTime(today)}</span>`;
}
//fungsi jam realtime
function initHeaderTick(){
  setInterval(()=>{
    const el = document.getElementById('clock');
    if(el) el.textContent = formatTime(new Date());
  }, 1000);
}

/* -------------------------
   Lookup Flow (FINAL)
----------------------------*/
//Helper Lookup
async function doLookupFromInput(){
  const v = $('inputUPC').value.trim();
  if(!v) return;
  await lookup(v);
  $('inputQty').focus();
}
//fungsi lookup
async function lookup(value){
  // try dataOpname by UPC then by Article
  currentMode = null;
  currentRecord = null;

  // try by UPC in opname
  let rec = await getOpnameByUPC(value);
  if(!rec){
    // try by Article in opname
    rec = await getOpnameByArticle(value);
  }
  if(rec){
    currentMode = 'EDIT';
    currentRecord = rec;
    fillFormFromOpname(rec);
    highlightMode('EDIT');
    return;
  }

  // not in opname -> try master
  let master = await getMasterByUPC(value);
  if(!master){
    master = await getMasterByArticle(value);
  }
  if(master){
    currentMode = 'NEW';
    currentRecord = master;
    fillFormFromMaster(master);
    highlightMode('NEW');
    return;
  }

  // not found anywhere
  currentMode = 'UNKNOWN';
  currentRecord = { upc: value, article:'', deskripsi:'', harga:'' };
  setFormForUnknown(value);
  highlightMode('UNKNOWN');
  showAlert('info', 'Data tidak ditemukan di opname maupun master. Silakan isi Article/Deskripsi jika ingin menambahkan.')
  setTimeout(() => {
    $('inputQty').focus();
}, 50);
}

//fungsi tampilkan hasil Opname ke form
function fillFormFromOpname(rec){
  $('inputUPC').value = rec.upc || '';
  $('inputArticle').value = rec.article || '';
  $('inputDesc').value = rec.deskripsi || '';
  $('inputHarga').value = rec.harga || '';
  $('inputQty').value = rec.qty != null ? rec.qty : '';
  $('inputKet').value = rec.keterangan || '';
}
//fungsi tampilkan hasil master ke form
function fillFormFromMaster(m){
  $('inputUPC').value = m.upc || '';
  $('inputArticle').value = m.article || '';
  $('inputDesc').value = m.deskripsi || '';
  $('inputHarga').value = m.harga || '';
  $('inputQty').value = '';
  $('inputKet').value = '';
}
//fungsi data tidak di ditemukan
function setFormForUnknown(upc){
  $('inputUPC').value = upc || '';
  $('inputArticle').value = '';
  $('inputDesc').value = '';
  $('inputHarga').value = '';
  $('inputQty').value = '';
  $('inputKet').value = '';
  // make article & desc editable
  $('inputArticle').readOnly = false;
  $('inputDesc').readOnly = false;
  $('inputHarga').readOnly = false;
}
//helper readonly jadi editable
function highlightMode(mode){
  // reset readonly defaults for Article/Desc
  if(mode === 'UNKNOWN'){
    $('inputArticle').readOnly = false;
    $('inputDesc').readOnly = false;
    $('inputHarga').readOnly = false;
  } else {
    $('inputArticle').readOnly = true;
    $('inputDesc').readOnly = true;
    $('inputHarga').readOnly = true;
  }

  // simple visual feedback: change box-shadow tint on inputs
  const elUpc = $('inputUPC');
  if(mode === 'EDIT'){
    elUpc.style.boxShadow = 'inset 4px 4px 8px rgba(0,0,0,.06), inset -4px -4px 8px rgba(255,255,255,.95), 0 0 0 3px rgba(96,165,250,0.12)';
  } else if(mode === 'NEW'){
    elUpc.style.boxShadow = 'inset 4px 4px 8px rgba(0,0,0,.06), inset -4px -4px 8px rgba(255,255,255,.95), 0 0 0 3px rgba(102,187,106,0.10)';
  } else if(mode === 'UNKNOWN'){
    elUpc.style.boxShadow = 'inset 4px 4px 8px rgba(0,0,0,.06), inset -4px -4px 8px rgba(255,255,255,.95), 0 0 0 3px rgba(250,183,77,0.12)';
  } else {
    elUpc.style.boxShadow = '';
  }
}

/* -------------------------
   Save (insert/update)
----------------------------*/
//fungsi tombol klik Save
async function onClickSaveOpname(){
  await saveOpname();

}
//fungsi save data
async function saveOpname(){
  const upc = $('inputUPC').value.trim();
  const article = $('inputArticle').value.trim();
  const deskripsi = $('inputDesc').value.trim();
  const harga = $('inputHarga').value.trim();
  const qtyRaw = $('inputQty').value;
  const qty = qtyRaw === '' ? null : Number(qtyRaw);
  const keterangan = $('inputKet').value.trim();
  const ts = Date.now();

  if(!upc){
    showAlert('info', 'UPC / Article harus diisi.');
    return;
  }
  // If UNKNOWN but Article empty => require article
  if(currentMode === 'UNKNOWN' && !article){
    showAlert('info', 'Karena data tidak ditemukan, mohon isi Article minimal.');
    return;
  }

  // prepare record
  const rec = {
    upc,
    article: article || (currentRecord && currentRecord.article) || '',
    deskripsi: deskripsi || (currentRecord && currentRecord.deskripsi) || '',
    harga: harga || (currentRecord && currentRecord.harga) || '',
    qty: qty,
    keterangan,
    timestamp: ts
  };

  // if mode is EDIT -> update existing
  if(currentMode === 'EDIT'){
    await putOpname(rec);
    showAlert('info', 'Data opname diupdate.');
  } else {
    // NEW or UNKNOWN => insert (put handles both)
    await putOpname(rec);
    showAlert('success','Data opname tersimpan.');
  }
  
    // === SIMPAN FOTO JIKA ADA ===
  if (tempFotoBlob) {
      const fotoId = `${rec.article}_${rec.qty}`;
      await saveFotoToDB(fotoId, tempFotoBlob);
  
      // reset foto setelah simpan
      tempFotoBlob = null;
      $('inputFoto').value = "";
      $('fotoHintBox').classList.add('hidden');
   }

  // Reset form for next input
  clearFormAfterSave();
}
//reset form setelah simpan data
function clearFormAfterSave(){
  $('inputUPC').value = '';
  $('inputArticle').value = '';
  $('inputDesc').value = '';
  $('inputHarga').value = '';
  $('inputQty').value = '';
  $('inputKet').value = '';
  currentMode = null;
  currentRecord = null;
  highlightMode(null);
  $('inputUPC').focus();
}

/* -------------------------
   View Data modal & export
----------------------------*/
//tampilkan modal lihat data
async function showViewModal(){
  const arr = await getAllOpname();
  const container = $('viewTableContainer');
  const u = await getUserInfo();
  if (u) {
    $('viewUserInfo').textContent = `Diinput oleh: ${u.nama || '-'}`;
  } else {
    $('viewUserInfo').textContent = "";
  }
  
  if(arr.length === 0){
    container.innerHTML = '<div class="muted">Tidak ada data opname.</div>';
  } else {
    // build table
    let html = '<table><thead><tr><th>UPC</th><th>Article</th><th>Deskripsi</th><th>Harga</th><th>Qty</th><th>Keterangan</th><th>Waktu</th><th>Foto</th><th>Hapus</th></tr></thead><tbody>';
    arr.sort((a,b)=> (b.timestamp||0) - (a.timestamp||0));
    for(const r of arr){
      const time = r.timestamp ? new Date(r.timestamp).toLocaleString() : '-';
      html += `<tr>
        <td>${escapeHtml(r.upc)}</td>
        <td>${escapeHtml(r.article)}</td>
        <td>${escapeHtml(r.deskripsi)}</td>
        <td>${escapeHtml(r.harga)}</td>
        <td>${r.qty != null ? r.qty : ''}</td>
        <td>${escapeHtml(r.keterangan)}</td>
        <td>${time}</td>
        <td><button onclick="lihatFoto('${r.article}_${r.qty}')">Lihat</button></td>
        <td><button onclick="hapusItem('${r.upc}','${r.article}_${r.qty}')">Hapus</button></td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }
  $('modalView').classList.remove('hidden');
}
//helper fungsi hapus hapusItem
async function hapusItem(upc, fotoId) {
  const ok = confirm("Hapus item ini beserta foto?");
  if (!ok) return;

  try {
    // Hapus opname
    const store1 = tx(STORE_OPNAME, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store1.delete(upc);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    // Hapus foto jika ada
    const store2 = tx("dataFoto", "readwrite");
    await new Promise((resolve, reject) => {
      const req = store2.delete(fotoId);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    showAlert("success", "Item berhasil dihapus.");

    // Refresh modal table
    showViewModal();

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal menghapus item!");
  }
}
//escapeHtml
function escapeHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
//Export ke csv
async function exportOpnameCsv(){
  const ok = await showConfirm("Export semua data opname ke CSV?");
  if (!ok) return;

  const arr = await getAllOpname();
  if(arr.length === 0){ 
    showAlert('error', 'Tidak ada data untuk diexport'); 
    return; 
  }

  // Ambil user info (untuk nama & toko)
  const u = await getUserInfo(); 
  const namaUser = u?.nama || "-";
  const tokoAsal = u?.toko_asal || "-";
  const tokoTujuan = u?.toko_tujuan || "-";

  // Format tanggal dd-MM-yyyy
  const d = new Date();
  const tgl = [
    String(d.getDate()).padStart(2,'0'),
    String(d.getMonth()+1).padStart(2,'0'),
    d.getFullYear()
  ].join('-');

  const header = ['upc','article','deskripsi','harga','qty','keterangan','timestamp','DiInputOleh'];
  const lines = [header.join(',')];

  for(const r of arr){
    const row = [
      csvSafe(r.upc),
      csvSafe(r.article),
      csvSafe(r.deskripsi),
      csvSafe(r.harga),
      r.qty != null ? String(r.qty) : '',
      csvSafe(r.keterangan),
      r.timestamp ? new Date(r.timestamp).toISOString() : '',
      csvSafe(namaUser)
    ];
    lines.push(row.join(','));
  }

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);

  // 🔥 Nama file sesuai permintaan:
  const fileName = `DataTB_${tokoAsal}_${tokoTujuan}_${tgl}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  showAlert("success", "Export CSV berhasil!");
}

//fungsi parse csv
function parseCsv(text){
  const delimiter = autoDetectDelimiter(text);
  console.log("Detected delimiter:", delimiter);

  const lines = [];
  let cur = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    // delimiter dinamis
    if (ch === delimiter && !inQuotes) {
      row.push(cur);
      cur = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur !== '' || row.length > 0) {
        row.push(cur);
        lines.push(row);
        row = [];
        cur = '';
      }
      if (ch === '\r' && text[i + 1] === '\n') i++;
      continue;
    }

    cur += ch;
  }

  if (cur !== '' || row.length > 0) {
    row.push(cur);
    lines.push(row);
  }

  return lines;
}
//helper deteksi delimeter csv
function autoDetectDelimiter(text){
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;

  const line = text.split(/\r?\n/)[0]; // header saja

  for (const d of candidates) {
    const c = line.split(d).length;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }

  return best;
}
//helper parse csv file
function csvSafe(v){
  if(v == null) return '';
  const s = String(v);
  if(s.includes(',') || s.includes('"') || s.includes('\n')){
    return `"${s.replace(/"/g,'""')}"`;
  }
  return s;
}

//-------------------------
//FUNGSI KAMERA ZXING/ZEBRA
//-------------------------

//fungsi buka box scanner
async function openScannerModal() {
  const video = $('scannerVideo');
  await stopScannerAndClose();
  $('modalScanner').classList.remove('hidden');

  // ====================== iOS MODE ======================
  if (isIOS()) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "true");
      video.setAttribute("autoplay", "true");
      video.srcObject = stream;
      video.muted = true;
      video.play();

      scannerStream = stream;
      scannerRunning = true;

      // aktifkan tap-to-focus setelah kamera hidup
      setTimeout(() => enableTapToFocus(video), 500);

      const detector = new BarcodeDetector({
        formats: ["ean_13","ean_8","code_128","qr_code","upc_a","upc_e"]
      });

      const loop = async () => {
        if (!scannerRunning) return;

        try {
          const result = await detector.detect(video);
          if (result.length > 0) {
            const code = result[0].rawValue;

            await stopScannerAndClose();
            beepOK();
            $('inputUPC').value = code;
            lookup(code);
            return;
          }
        } catch (e) {}

        requestAnimationFrame(loop);
      };

      requestAnimationFrame(loop);
      return;

    } catch (err) {
      console.error("iOS scanner gagal:", err);
      showAlert("error", "Kamera iOS tidak bisa dibuka.");
      $('modalScanner').classList.add('hidden');
      return;
    }
  }

  // ====================== ANDROID / DESKTOP MODE ======================
  try {
    const hasZXing = typeof ZXing !== "undefined" && ZXing.BrowserMultiFormatReader;
    if (!hasZXing) throw "ZXing tidak tersedia";

    codeReader = new ZXing.BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();

    let cam = devices.find(d => /back|rear|environment/i.test(d.label));
    if (!cam) cam = devices[0];

    scannerRunning = true;

    // Tunggu video ready dulu untuk enable tap focus
    setTimeout(() => enableTapToFocus(video), 600);

    codeReader.decodeFromVideoDevice(cam.deviceId, video, async (result, err) => {
      if (result) {
        const code = result.text;
        await stopScannerAndClose();
        beepOK();
        $('inputUPC').value = code;
        lookup(code);
      }
    });

  } catch (err) {
    console.warn("ZXing gagal → fallback manual", err);
    showAlert("error", "Scanner tidak tersedia di perangkat ini.");
    $('modalScanner').classList.add('hidden');
  }
}
//fungsi stop kamera
async function stopScannerAndClose() {
  scannerRunning = false;

  try {
    if (codeReader) {
      codeReader.reset();
      codeReader = null;
    }
  } catch (e) {}

  if (scannerStream) {
    scannerStream.getTracks().forEach(t => {
      try { t.stop(); } catch(e){}
    });
    scannerStream = null;
  }

  const video = $('scannerVideo');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => {
      try { t.stop(); } catch(e){}
    });
    video.srcObject = null;
  }

  $('modalScanner').classList.add('hidden');
}
//beepsound scan
function beepOK(){
  if(beepLocked) return;
  beepLocked = true;

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.value = 1000;
  gain.gain.value = 0.3;

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  setTimeout(()=>{
    osc.stop();
    ctx.close();
    beepLocked = false;
  },250);
}

/* -------------------------
   Finish action (Reset userinfo, dataOpname, dataFoto)
----------------------------*/
async function onFinish() {
  const val = $('confirmOnFinish').value.trim().toUpperCase();

  if (val !== "SELESAI") {
    showAlert("error", "Konfirmasi salah. Ketik 'SELESAI' untuk melanjutkan.");
    return;
  }
  showLoading();
  try {
    // HAPUS dataOpname
    const store1 = tx(STORE_OPNAME, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store1.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    // HAPUS dataFoto juga
    const store2 = tx("dataFoto", "readwrite");
    await new Promise((resolve, reject) => {
      const req = store2.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
    
    //hapus UserInfo
    const store3 = tx(STORE_USER, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store3.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    showAlert("success", "Semua data opname dan foto berhasil dihapus!");
    $('modalOnFinish').style.display = "none";

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal menghapus data opname atau foto!");
  }
  location.reload();
  hideLoading();
}

//--------------------------------
//HELPER LOADING OVERLAY DAN ALERT
//--------------------------------



//Show Alert
function showAlert(type, message, duration = 2500) {
  const alertBox = document.createElement("div");
  alertBox.className = `alert-box ${type}`;
  alertBox.innerHTML = `<p>${message}</p>`;
  document.body.appendChild(alertBox);

  setTimeout(() => alertBox.classList.add("show"), 10);

  setTimeout(() => {
    alertBox.classList.remove("show");
    setTimeout(() => alertBox.remove(), 300);
  }, duration);
}


//Hapus data Opname
async function hapusSemuaOpname() {
  const ok = await showConfirm("Hapus SEMUA data opname beserta fotonya? Tindakan ini tidak bisa dibatalkan.");
  if (!ok) return;

  try {
    // HAPUS dataOpname
    const store1 = tx(STORE_OPNAME, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store1.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    // HAPUS dataFoto juga
    const store2 = tx("dataFoto", "readwrite");
    await new Promise((resolve, reject) => {
      const req = store2.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    showAlert("success", "Semua data opname dan foto berhasil dihapus!");

    // Refresh tampilan tabel
    showViewModal();

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal menghapus data opname atau foto!");
  }
}

//export xls
async function exportOpnameXls() {
  const ok = await showConfirm("Export semua data opname ke Excel (.xlsx)?");
  if (!ok) return;

  try {
    const arr = await getAllOpname();
    if (!arr.length) {
      showAlert("error", "Tidak ada data untuk diexport.");
      return;
    }

    // Ambil user info
    const u = await getUserInfo();
    const tokoAsal = u?.toko_asal || "Asal";
    const tokoTujuan = u?.toko_tujuan || "Tujuan";
    const tanggal = u?.tanggal || formatDate(new Date());

    const fileName = `DataTB_${tokoAsal}_ke_${tokoTujuan}_${tanggal}.xlsx`;

    // Siapkan data array untuk XLSX
    const rows = arr.map(r => ({
      UPC: r.upc,
      Article: r.article,
      Deskripsi: r.deskripsi,
      Harga: r.harga,
      Qty: r.qty != null ? r.qty : "",
      Keterangan: r.keterangan,
      Waktu: r.timestamp ? new Date(r.timestamp).toLocaleString() : "",
      DiInputOleh: u.nama || "-"
    }));

    // Buat worksheet
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "DataTB");

    // Generate file valid XLSX
    XLSX.writeFile(workbook, fileName);

    showAlert("success", "Export XLSX berhasil!");

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal export XLSX.");
  }
}
//share to wa
async function shareToWhatsapp() {
  const ok = await showConfirm("Kirim semua data opname ke WhatsApp?");
  if (!ok) return;

  try {
    const rows = await getAllOpname();
    if (!rows.length) {
      showAlert("error", "Tidak ada data untuk dikirim.");
      return;
    }

    // Ambil user info
    const u = await getUserInfo();
    const tokoAsal = u?.toko_asal || "-";
    const tokoTujuan = u?.toko_tujuan || "-";

    // Bangun pesan
    let message = `Data TB ${tokoAsal} ke ${tokoTujuan}:\n\n`;

    // Urutkan (opsional)
    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const r of rows) {
      const article = r.article || "-";
      const qty = r.qty != null ? r.qty : "-";
      message += `${article} : ${qty}\n`;
    }

    // Encode untuk WA
    const url = "https://wa.me/?text=" + encodeURIComponent(message);

    // Buka WA (user pilih kontak/grup)
    window.open(url, "_blank");

    showAlert("success", "Membuka WhatsApp...");

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal membuat pesan WhatsApp.");
  }
}

//convertBlob
function fileToBlob(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Blob([reader.result], { type: file.type }));
    reader.readAsArrayBuffer(file);
  });
}


//helperindex
async function saveFotoToDB(id, blob) {
  const store = tx('dataFoto', 'readwrite');
  return new Promise((res, rej) => {
    const req = store.put({ id, blob });
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function getFotoFromDB(id) {
  const store = tx('dataFoto');
  return new Promise((res, rej) => {
    const req = store.get(id);
    req.onsuccess = () => res(req.result ? req.result.blob : null);
    req.onerror = () => rej(req.error);
  });
}

//lihatFoto
async function lihatFoto(id) {
  const blob = await getFotoFromDB(id);
  if (!blob) {
    showAlert("error", "Foto tidak ditemukan.");
    return;
  }

  const url = URL.createObjectURL(blob);
  $('fotoPreview').src = url;
  $('modalFoto').classList.remove('hidden');
}

//helperAmbilFoto
async function getAllFoto() {
  const store = tx("dataFoto");
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

//FungsikompressFotoKeZip
async function downloadAllPhotosZip() {
  const ok = await showConfirm("Unduh semua foto?");
  if (!ok) return; // batal

  try {
    const fotos = await getAllFoto();
    if (!fotos.length) {
      showAlert("error", "Tidak ada foto untuk diunduh.");
      return;
    }

    // Ambil user info
    const u = await getUserInfo();
    const tokoAsal = u?.toko_asal || "-";
    const tokoTujuan = u?.toko_tujuan || "-";
    const tanggal = u?.tanggal?.replace(/\//g, "-") || formatDate(new Date()).replace(/\//g, "-");

    // Nama file ZIP
    const zipName = `Foto_TB_${tokoAsal}_Ke_${tokoTujuan}_${tanggal}.zip`;

    // Buat ZIP
    const zip = new JSZip();
    const folder = zip.folder(zipName);

    for (const item of fotos) {
      if (!item.blob) continue;

      const blob = item.blob;
      const fileName = `${item.id}.jpg`; // id sudah berbentuk article_qty

      folder.file(fileName, blob);
    }

    // Generate ZIP
    const content = await zip.generateAsync({ type: "blob" });

    // Trigger download
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    a.click();
    URL.revokeObjectURL(url);

    showAlert("success", "Semua foto berhasil diunduh!");

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal mengunduh foto!");
  }
}


//parse csv&xls untuk upload dataMaster
async function parseMasterFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  // ===== CSV HANDLER =====
  if (ext === 'csv') {
    const text = await file.text();
    return parseCsv(text); // AUTO DELIMITER
  }

  // ===== XLS / XLSX HANDLER =====
  if (ext === 'xls' || ext === 'xlsx') {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    const rows = raw
      .filter(r => r && r.length)
      .map(r => r.map(c => (c ?? "").toString().trim()));

    return rows;
  }

  throw new Error("Format tidak didukung. Gunakan CSV atau XLS/XLSX.");
}

function showLoading() {
  $('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  $('loadingOverlay').classList.add('hidden');
}

async function hapusDataMaster() {
  const val = $('confirmMasterDelete').value.trim().toUpperCase();

  if (val !== "HAPUS") {
    showAlert("error", "Konfirmasi salah. Ketik 'HAPUS' untuk melanjutkan.");
    return;
  }

  try {
    showLoading();
    const t = db.transaction([STORE_MASTER], "readwrite");
    const store = t.objectStore(STORE_MASTER);

    await new Promise((res, rej) => {
      const req = store.clear();
      req.onsuccess = res;
      req.onerror = () => rej(req.error);
    });

    showAlert("success", "Semua data master berhasil dihapus.");
    $('modalMaster').style.display = "none";

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal menghapus data master!");
  }
  hideLoading();
}

async function showConfirm(message){
  return new Promise(resolve => {

    // kalau masih ada confirm sebelumnya → force resolve false
    if(_confirmResolve){
      _confirmResolve(false);
    }

    _confirmResolve = resolve;
    _confirmPromise = true;

    $('confirmMessage').textContent = message;
    $('confirmOverlay').style.display = 'flex';

    const yes = $('confirmYes');
    const no  = $('confirmNo');

    const onYes = () => finish(true);
    const onNo  = () => finish(false);

    yes.addEventListener('click', onYes, {once:true});
    no.addEventListener('click', onNo,   {once:true});

    function finish(val){
      $('confirmOverlay').style.display = 'none';
      _confirmResolve = null;
      _confirmPromise = null;
      resolve(val);
    }

  });
}

// -----------------------------
// FILE SLICE STREAMING IMPORT
// - delimiter: semicolon (";")
// - columns expected: UPC, Artikel, Deskripsi, Harga (header fleksibel)
// - robust terhadap kutipan yang memuat newline
// - batch insert ke IndexedDB
// -----------------------------

async function getAllMasterUPC() {
  // return Set of all existing UPC keys
  const store = tx(STORE_MASTER);
  return new Promise((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result || []));
    req.onerror = () => reject(req.error);
  });
}

async function saveMasterBulk(list) {
  // list: array of { upc, article, deskripsi, harga }
  if (!list || !list.length) return;
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_MASTER], "readwrite");
    const store = t.objectStore(STORE_MASTER);
    for (const it of list) {
      store.put(it);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// parse a CSV line with given delimiter, respecting quotes (") and escaped quotes ("")
function parseCsvLine(line, delimiter = ';') {
  const res = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // handle escaped double quote
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        cur += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      res.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  res.push(cur);
  return res;
}

function countQuotes(s) {
  if (!s) return 0;
  let c = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '"') c++;
  return c;
}

/**
 * Main streaming import function (replace existing onFileMasterSelected)
 */

//uploadmaster asli
async function onFileMasterSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  showLoading();

  let isZip = file.name.toLowerCase().endsWith(".zip");

  try {
    // =====================================================
    // 1. KUMPULKAN SEMUA CSV (dari zip / single csv/xls)
    // =====================================================
    let csvSources = [];

    if (isZip) {
      // ZIP MODE
      const extracted = await extractCsvFromZip(file);

      if (extracted.length === 0) {
        showAlert("error", "ZIP tidak berisi CSV.");
        return;
      }

      // sumber csv zip
      csvSources = extracted.map(x => ({
        name: x.name,
        type: "csv",
        content: x.content
      }));
    } else {
      // SINGLE FILE MODE (CSV atau XLS/XLSX)
      csvSources = [{ name: file.name, type: "single", file }];
    }

    // =====================================================
    // 2. VAR-READY UNTUK RINGKASAN TOTAL
    // =====================================================
    let totalSemua = 0;
    let totalSukses = 0;
    let totalDuplicate = 0;
    let totalGagal = 0;

    const existingUPC = await getAllMasterUPC(); // Set
    const CHUNK = 800;

    // =====================================================
    // 3. PROSES SATU PER SATU FILE CSV
    // =====================================================
    for (const src of csvSources) {
      let rows;

      try {
        if (src.type === "csv") {
          rows = parseCsv(src.content);
        } else {
          rows = await parseMasterFile(src.file); // CSV/XLS bawaan
        }
      } catch (err) {
        console.error("Gagal parse file:", src.name, err);
        showAlert("error", `Gagal parse ${src.name}, dilewati.`);
        continue; // LANJUT FILE BERIKUTNYA
      }

      if (!rows || rows.length < 2) {
        showAlert("error", `File ${src.name} kosong / tidak valid.`);
        continue;
      }

      // ================= 4. NORMALISASI HEADER =================
      const header = (rows[0] || []).map(h => String(h ?? "").toLowerCase().trim());

      const upcIdx  = header.findIndex(h => h.includes("upc"));
      const artIdx  = header.findIndex(h => h.includes("article") || h.includes("artikel"));
      const descIdx = header.findIndex(h =>
        h.includes("deskripsi") ||
        h.includes("description") ||
        h.includes("article description")
      );
      const hargaIdx  = header.findIndex(h => h.includes("harga") || h.includes("price"));

      if (upcIdx === -1 || artIdx === -1 || descIdx === -1) {
        showAlert("error", `Header invalid pada ${src.name}. Dilewati.`);
        continue;
      }

      // ================= 5. LOOP DATA =================
      const buffer = [];
      let sukses = 0, duplicate = 0, gagal = 0;

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length === 0) continue;

        const rawUpc = String(r[upcIdx] ?? "").trim();
        const article = String(r[artIdx] ?? "").trim();
        const deskripsi = String(r[descIdx] ?? "").trim();
        const harga = String(r[hargaIdx] ?? "").trim();

        const upc = rawUpc.replace(/\s+/g, "");

        if (!upc) {
          gagal++;
          continue;
        }

        if (existingUPC.has(upc)) {
          duplicate++;
          continue;
        }

        buffer.push({ upc, article, deskripsi, harga });
        existingUPC.add(upc);
        sukses++;

        if (buffer.length >= CHUNK) {
          await saveMasterBulk(buffer.splice(0, buffer.length));
        }
      }

      if (buffer.length > 0) {
        await saveMasterBulk(buffer);
      }

      // ================= 6. AKUMULASI KE TOTAL =================
      totalSemua += (rows.length - 1);
      totalSukses += sukses;
      totalDuplicate += duplicate;
      totalGagal += gagal;

      showAlert("success", `File ${src.name} selesai diproses.`);
    }

    // =====================================================
    // 7. RINGKASAN AKHIR (SEMUA FILE)
    // =====================================================
    showAlert(
      "success",
      `IMPORT MULTI-FILE SELESAI!\n\n` +
      `Total Rows Semua File: ${totalSemua}\n` +
      `Sukses Ditambahkan: ${totalSukses}\n` +
      `Duplicate: ${totalDuplicate}\n` +
      `Gagal: ${totalGagal}`
    );

  } catch (err) {
    console.error(err);
    showAlert("error", "Kesalahan saat memproses file.");
  }

  // CLEANUP
  finally {
    hideLoading();
    const input = document.getElementById("fileMaster");
    if (input) input.value = "";
  }
}

//helper parsing csvFiles
async function processSingleMasterFile(file, existingUPC_Global = null) {
  const rows = await parseMasterFile(file);

  if (!rows || rows.length < 2) {
    return { sukses: 0, duplicate: 0, gagal: 0 };
  }

  const header = rows[0].map(h => h.toString().toLowerCase().trim());

  const upcIdx = header.findIndex(h => h.includes("upc"));
  const artIdx = header.findIndex(h => h.includes("article") || h.includes("artikel"));
  const descIdx = header.findIndex(h =>
    h.includes("deskripsi") ||
    h.includes("description") ||
    h.includes("article description")
  );
  const hargaIdx = header.findIndex(h => h.includes("harga") || h.includes("price"));

  if (upcIdx === -1 || artIdx === -1 || descIdx === -1) {
    return { sukses: 0, duplicate: 0, gagal: rows.length-1 };
  }

  const existingUPC = existingUPC_Global || await getAllMasterUPC();
  const buffer = [];

  let sukses = 0;
  let duplicate = 0;
  let gagal = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;

    const upc = (r[upcIdx] || "").trim();
    const article = (r[artIdx] || "").trim();
    const deskripsi = (r[descIdx] || "").trim();
    const harga = (r[hargaIdx] || "").trim();

    if (!upc) {
      gagal++;
      continue;
    }

    if (existingUPC.has(upc)) {
      duplicate++;
      continue;
    }

    buffer.push({ upc, article, deskripsi, harga });
    existingUPC.add(upc);

    sukses++;
  }

  if (buffer.length > 0) {
    await saveMasterBulk(buffer);
  }

  return { sukses, duplicate, gagal };
}

//fungsi zip file
async function extractCsvFromZip(file) {
  const zip = await JSZip.loadAsync(file);
  const csvFiles = [];

  for (const filename of Object.keys(zip.files)) {
    if (filename.toLowerCase().endsWith(".csv")) {
      try {
        const content = await zip.files[filename].async("string");
        csvFiles.push({ name: filename, content });
      } catch (err) {
        console.error("Gagal baca CSV:", filename, err);
      }
    }
  }

  return csvFiles;
}



//taptofocus
function enableTapToFocus(video) {
  if (!video) return;

  video.addEventListener("click", async (ev) => {
    try {
      const stream = video.srcObject;
      if (!stream) return;

      const track = stream.getVideoTracks()[0];
      const cap = track.getCapabilities();

      // === TAMPILKAN ANIMASI TAP FOCUS ===
      showFocusPulse(ev.clientX, ev.clientY);

      // ============ iOS support titik fokus ============
      if (cap.focusPointX && cap.focusPointY) {
        const rect = video.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;

        await track.applyConstraints({
          advanced: [
            { focusMode: "manual", focusPointX: x, focusPointY: y }
          ]
        });

        // balikin ke autofocus
        setTimeout(() => {
          track.applyConstraints({
            advanced: [{ focusMode: "continuous" }]
          });
        }, 300);

        return;
      }

      // ============ ANDROID (tidak support titik fokus) ============
      if (cap.focusMode && cap.focusMode.includes("continuous")) {

        // matikan autofocus sebentar
        await track.applyConstraints({
          advanced: [{ focusMode: "manual" }]
        });

        // hidupkan lagi autofocus (trigger refocus)
        setTimeout(() => {
          track.applyConstraints({
            advanced: [{ focusMode: "continuous" }]
          });
        }, 200);

      }

    } catch (err) {
      console.warn("Tap focus failed:", err);
    }
  });
}

//efek pulse
function showFocusPulse(x, y) {
  const pulse = $('focusPulse');
  pulse.style.left = x + "px";
  pulse.style.top = y + "px";
  pulse.style.opacity = "1";
  pulse.style.transform = "translate(-50%, -50%) scale(1.5)";

  setTimeout(() => {
    pulse.style.opacity = "0";
    pulse.style.transform = "translate(-50%, -50%) scale(1)";
  }, 300);
}

async function shareToWhatsappIOS() {
  try {
    const rows = await getAllOpname();
    if (!rows.length) {
      showAlert("error", "Tidak ada data untuk dikirim.");
      return;
    }

    const u = await getUserInfo();
    const tokoAsal = u?.toko_asal || "-";
    const tokoTujuan = u?.toko_tujuan || "-";

    let message = `Data TB ${tokoAsal} ke ${tokoTujuan}:\n\n`;

    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const r of rows) {
      message += `${r.article || "-"} : ${r.qty ?? "-"}\n`;
    }

    const url = "https://wa.me/?text=" + encodeURIComponent(message);

    // iOS WA FIX
    window.location.href = url;

    setTimeout(() => {
      showAlert("success", "Membuka WhatsApp...");
    }, 300);

  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal membuat pesan WhatsApp.");
  }
}

async function fetchMasterZip() {
  const resp = await fetch("./master.zip"); 
  if (!resp.ok) throw new Error("Gagal memuat master.zip: HTTP " + resp.status);
  return await resp.arrayBuffer(); // isi ZIP
}


async function extractCsvFromZipBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const list = [];

  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().endsWith(".csv")) {
      const content = await zip.files[name].async("string");
      list.push({ name, content });
    }
  }

  return list; // [{name, content}]
}


async function importCsvListToMaster(csvList) {

  const existingUPC = await getAllMasterUPC();
  const CHUNK = 800;

  // ringkasan total
  let totalAll = 0;
  let totalSukses = 0;
  let totalDuplicate = 0;
  let totalGagal = 0;

  // proses tiap file CSV di ZIP
  for (const file of csvList) {
    
    let sukses = 0;
    let duplicate = 0;
    let gagal = 0;

    let rows;
    try {
      rows = parseCsv(file.content);
    } catch (e) {
      showAlert("error", `Gagal parse ${file.name}, dilewati.`);
      continue;
    }

    if (!rows || rows.length < 2) {
      showAlert("error", `${file.name}: kosong atau tidak valid.`);
      continue;
    }

    const header = rows[0].map(h => h.toLowerCase().trim());
    const upcIdx  = header.findIndex(h => h.includes("upc"));
    const artIdx  = header.findIndex(h => h.includes("article") || h.includes("artikel"));
    const descIdx = header.findIndex(h => h.includes("deskripsi") || h.includes("description"));
    const hargaIdx = header.findIndex(h => h.includes("harga") || h.includes("price"));

    if (upcIdx === -1 || artIdx === -1 || descIdx === -1) {
      showAlert("error", `${file.name}: header tidak cocok, dilewati.`);
      continue;
    }

    const buffer = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const upc = (r[upcIdx] || "").trim();
      totalAll++;

      if (!upc) {
        gagal++;
        continue;
      }

      if (existingUPC.has(upc)) {
        duplicate++;
        continue;
      }

      buffer.push({
        upc,
        article: (r[artIdx] || "").trim(),
        deskripsi: (r[descIdx] || "").trim(),
        harga: (r[hargaIdx] || "").trim(),
      });

      existingUPC.add(upc);

      sukses++;
      totalSukses++;

      if (buffer.length >= CHUNK) {
        await saveMasterBulk(buffer.splice(0));
      }
    }

    if (buffer.length > 0) {
      await saveMasterBulk(buffer);
    }

    totalDuplicate += duplicate;
    totalGagal += gagal;

    // 🔥 ALERT SUKSES PER FILE
    showAlert(
      "success",
      `${file.name} selesai:\n` +
      `Sukses: ${sukses}\n` +
      `Duplicate: ${duplicate}\n` +
      `Gagal: ${gagal}`
    );
  }

  // 🔥 ALERT RINGKASAN TOTAL
  showAlert(
    "success",
    `IMPORT SELESAI!\n\n` +
    `Total baris: ${totalAll}\n` +
    `Sukses: ${totalSukses}\n` +
    `Duplicate: ${totalDuplicate}\n` +
    `Gagal: ${totalGagal}`
  );
}


async function loadMasterFromZip() {
  showLoading();

  try {
    const buf = await fetchMasterZip();
    const csvFiles = await extractCsvFromZipBuffer(buf);

    if (!csvFiles.length) {
      showAlert("error", "ZIP tidak berisi file CSV.");
      return;
    }

    await importCsvListToMaster(csvFiles);
   // showAlert("success", "Master ZIP berhasil dimuat!");
  } catch (err) {
    console.error(err);
    showAlert("error", "Gagal memuat master.zip");
  }

  hideLoading();
}
