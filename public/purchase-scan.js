const cdn = "https://cdn.jsdelivr.net/npm/";
const pdfPath = cdn + "pdfjs-dist@5.4.624/build/";
const ocrPath = cdn + "tesseract.js@6.0.1/dist/";

async function imageReader() {
  const script = document.createElement("script");
  script.src = ocrPath + "tesseract.min.js";
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  return Tesseract.createWorker(["kor", "eng"], 1, {
    corePath: cdn + "tesseract.js-core@6.0.0",
    workerPath: ocrPath + "worker.min.js",
    cacheMethod: "none",
  });
}

let ocrReady;
function getImageReader(){
  return ocrReady??=imageReader().catch(error=>{ocrReady=null;throw error;});
}
async function recognize(reader,input){
  const {data}=await reader.recognize(input);
  return data.text;
}

async function readDocument(file, pageLimit, progress) {
  if (!/\.pdf$/i.test(file.name)) {
    progress("이미지에서 글자를 읽는 중…");
    const readerReady=getImageReader();
    void readerReady.catch(()=>{});
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2500 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      try {return await recognize(await readerReady,canvas);}
      finally {canvas.width=canvas.height=0;}
    } finally {
      image.close();
    }
  }
  progress("PDF 읽기 도구를 준비하는 중…");
  const pdfjs = await import(pdfPath + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfPath + "pdf.worker.min.mjs";
  let failRange;
  const rangeFailure=new Promise((_,reject)=>{failRange=reject;});
  class LocalPdfRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin,end) {
      file.slice(begin,end).arrayBuffer().then(buffer=>this.onDataRange(begin,new Uint8Array(buffer))).catch(failRange);
    }
  }
  const input=file.size>2_000_000
    ?{range:new LocalPdfRange(file.size,new Uint8Array(await file.slice(0,65536).arrayBuffer()),true),disableStream:true,disableAutoFetch:true}
    :{data:await file.arrayBuffer()};
  const task = pdfjs.getDocument({
    ...input, isEvalSupported: false, useWasm: false, maxImageSize: 20000000,
  });
  try {
    const pdf = await Promise.race([task.promise,rangeFailure]);
    const pages = [];
    const count=Math.min(pdf.numPages,pageLimit);
    for (let index = 1; index <= count; index++) {
      progress("PDF "+index+"/"+count+"쪽에서 텍스트 확인 중…");
      const page = await Promise.race([pdf.getPage(index),rangeFailure]);
      const { items } = await Promise.race([page.getTextContent(),rangeFailure]);
      const text = items.map(item => (item.str || "") + (item.hasEOL ? "\n" : " ")).join("");
      if (text.trim().length >= 30) {
        pages.push(text);
        continue;
      }
      progress("PDF "+index+"/"+count+"쪽의 스캔 이미지에서 글자 읽는 중…");
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, (pageLimit===1?2000:2400) / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        const readerReady=getImageReader();
        void readerReady.catch(()=>{});
      // The hidden scanner frame does not reliably receive animation frames.
      await Promise.race([page.render({canvas,viewport,intent:"print"}).promise,rangeFailure]);
      progress("PDF "+index+"/"+count+"쪽의 글자를 인식하는 중…");
        pages.push(await recognize(await readerReady,canvas));
      } finally {canvas.width=canvas.height=0;page.cleanup();}
    }
    return {text:pages.join("\n"),pagesRead:count,totalPages:pdf.numPages};
  } finally {
    await task.destroy();
  }
}

let reading=false;
async function receiveDocument(event){
  const {file,pageLimit}=event.data||{};
  if (event.source !== parent || !event.ports.length || !(file instanceof File)) return;
  const [port] = event.ports;
  if(reading){
    port.postMessage({error:"다른 문서를 읽는 중입니다."});
    port.close();
    return;
  }
  reading=true;
  try {
    const result=await readDocument(file,pageLimit===5?5:1,status=>port.postMessage({status}));
    const normalized=typeof result==="string"?{text:result}:result;
    port.postMessage({...normalized,text:normalized.text.slice(0,30000)});
  } catch {
    port.postMessage({error:"문서를 읽지 못했습니다. 파일이 열리는지 확인한 뒤 다시 선택해 주세요."});
  } finally {
    reading=false;
    port.close();
  }
}
window.addEventListener("message",receiveDocument);
parent.postMessage("purchase-scan-ready","*");
