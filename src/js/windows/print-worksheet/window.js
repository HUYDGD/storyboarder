const {ipcRenderer, remote} = require('electron')
const pdf = require('pdfjs-dist')
const child_process = require('child_process')
const app = remote.app
const os = require('os')
const path = require('path')

const prefModule = remote.require('./prefs')
const worksheetPrinter = require('./worksheet-printer')
// const exporter = require('../../window/exporter')
const storyTips = new(require('../../window/story-tips'))
// const exporterCommon = require('../../exporters/common')

//#region Localization
const i18n = require('../../services/i18next.config.js')

i18n.on('loaded', (loaded) => {
  let lng = ipcRenderer.sendSync("getCurrentLanguage")
  i18n.changeLanguage(lng, () => {
    updateHTML()
    i18n.on("languageChanged", changeLanguage)
  })
  i18n.off('loaded')
})

const changeLanguage = (lng) => {
  updateHTML()
  ipcRenderer.send("languageChanged", lng)
}

ipcRenderer.on("languageChanged", (event, lng) => {
  i18n.off("languageChanged", changeLanguage)
  i18n.changeLanguage(lng, () => {
    updateHTML()
    i18n.on("languageChanged", changeLanguage)
  })
})

ipcRenderer.on("languageModified", (event, lng) => {
  i18n.reloadResources(lng).then(() => {updateHTML();})
})

ipcRenderer.on("languageAdded", (event, lng) => {
  i18n.loadLanguages(lng).then(() => { i18n.changeLanguage(lng); })
})

ipcRenderer.on("languageRemoved", (event, lng) => {
  i18n.changeLanguage(lng)
})

const translateHtml = (elementName, traslationKey) => {
  let elem = document.querySelector(elementName)
  if(!elem || !elem.childNodes.length) return
  elem.childNodes[elem.childNodes.length - 1].textContent = i18n.t(traslationKey)
}

const updateHTML = () => {
  translateHtml("#config-title", "print-window.worksheet-title")
  translateHtml("#config-intro", "print-window.worksheet-intro") 

  translateHtml("#paper-size", "print-window.paper-size")
  translateHtml("#letter", "print-window.letter")
  translateHtml("#format", "print-window.format")
  translateHtml("#paper-orientation-label", "print-window.paper-orientation-label")
  translateHtml("#paper-orientation-landscape", "print-window.paper-orientation-landscape")
  translateHtml("#paper-orientation-portrait", "print-window.paper-orientation-portrait")
  translateHtml("#columns-label", "print-window.columns-label")
  translateHtml("#rows-label", "print-window.rows-label")
  translateHtml("#spacing-label", "print-window.spacing-label")
  translateHtml("#copies-label", "print-window.copies-label")
  translateHtml("#print-button", "print-window.print-button")
  translateHtml("#pdf-button", "print-window.pdf-button")
  translateHtml("#prev_button", "print-window.prev_button")
  translateHtml("#page-info", "print-window.page-info")
  translateHtml("#next_button", "print-window.next_button")
}
//#endregion


let paperSize
let paperOrientation
let rows
let cols
let spacing

let aspectRatio
let currentScene
let scriptData
let pdfdocument
// on change save preferences

const cleanup = () => {
  pdfdocument = null
}

window.pdf = pdf
document.querySelector('#close-button').onclick = (e) => {
  ipcRenderer.send('playsfx', 'negative')
  let window = remote.getCurrentWindow()
  cleanup()
  window.hide()
}
document.addEventListener('keyup', event => {
  if (event.key == 'Escape') {
    ipcRenderer.send('playsfx', 'negative')
    let window = remote.getCurrentWindow()
    cleanup()
    window.hide()
  }
})

document.querySelector('#print-button').onclick = (e) => {
  if (!pdfdocument) return false;
  ipcRenderer.send('playsfx', 'positive')
  // PRINT
  print()
  let window = remote.getCurrentWindow()
  cleanup()
  window.hide()
}

document.querySelector('#pdf-button').onclick = (e) => {
  if (!pdfdocument) return false;
  ipcRenderer.send('exportPrintableWorksheetPdf', pdfdocument)
  cleanup()
  remote.getCurrentWindow().hide()
}

const print = () => {
  let boardFilename = null
  let cmd
  let output
  switch (os.platform()) {
    case 'darwin':
      cmd = 'lpr -o media=' + ((paperSize === 'LTR') ? 'letter' : 'a4') + ((paperOrientation === 'landscape' || !boardFilename) ? ' -o orientation-requested=4' : '') + ' -#' + document.querySelector('#copies').value + ' ' + pdfdocument
      output = child_process.execSync(cmd)
      break
    case 'linux':
      cmd = 'lp -n ' + document.querySelector('#copies').value + ' ' +  pdfdocument
      output = child_process.execSync(cmd)
      break
    case 'win32':
      cmd = path.join(app.getAppPath(), 'src', 'data', 'app', 'SumatraPDF.exe')
      let params = ['-print-to-default', '-silent', '-print-settings "' + document.querySelector('#copies').value + 'x"', pdfdocument]
      console.log(params)
      child_process.execFile(cmd, params, (e,s,d)=> {
        console.log(s)
      })
      break
  }
  ipcRenderer.send('analyticsEvent', 'Board', 'print', null, document.querySelector('#copies').value)
}

document.querySelector('#paper-size').addEventListener('change', (e) => {
  paperSize = e.target.value
  generatePDF()
  prefModule.set('printingWindowState.paperSize', paperSize)
})

document.querySelector('#paper-orientation').addEventListener('change', (e) => {
  paperOrientation = e.target.value
  generatePDF()
  prefModule.set('printingWindowState.paperOrientation', paperOrientation)
})

document.querySelector('#row-number').addEventListener('change', (e) => {
  rows = e.target.value
  generatePDF()
  prefModule.set('printingWindowState.rows', rows)
})

document.querySelector('#column-number').addEventListener('change', (e) => {
  cols = e.target.value
  generatePDF()
  prefModule.set('printingWindowState.cols', cols)
})

document.querySelector('#spacing').addEventListener('change', (e) => {
  spacing = e.target.value
  generatePDF()
  prefModule.set('printingWindowState.spacing', spacing)
})

const displaySpinner = (visible) => {
  document.querySelector('#preview-loading').style.display = (visible) ? 'flex' : 'none';
  document.querySelector('#paper-size').disabled = visible
  document.querySelector('#paper-orientation').disabled = visible
  document.querySelector('#row-number').disabled = visible
  document.querySelector('#column-number').disabled = visible
  document.querySelector('#spacing').disabled = visible
}

const loadWindow = () => {
  let prefs = prefModule.getPrefs('print window')

  let printingWindowState

  if (!prefs.printingWindowState) {
    printingWindowState = {
      paperSize: 'LTR',
      paperOrientation: 'landscape',
      rows: 5,
      cols: 3,
      spacing: 15
    }
    prefModule.set('printingWindowState', printingWindowState)
  } else {
    printingWindowState = prefs.printingWindowState
  }

  paperSize = printingWindowState.paperSize
  paperOrientation = printingWindowState.paperOrientation
  rows = printingWindowState.rows
  cols = printingWindowState.cols
  spacing = printingWindowState.spacing

  document.querySelector('#paper-size').value = paperSize
  document.querySelector('#paper-orientation').value = paperOrientation
  document.querySelector('#row-number').value = rows
  document.querySelector('#column-number').value = cols
  document.querySelector('#spacing').value = spacing

  document.querySelector('#prev_button').addEventListener('click', onPrevPage);
  document.querySelector('#next_button').addEventListener('click', onNextPage);

  worksheetPrinter.on('generated', async (path)=>{
    // Disable workers to avoid yet another cross-origin issue (workers need
    // the URL of the script to be loaded, and dynamically loading a cross-origin
    // script does not work).
    // PDFJS.disableWorker = true;

    // The workerSrc property shall be specified.
    //console.log(require('pdfjs-dist/build/pdf.worker'))

    await reloadPDFDocument(path)

    //console.log(remote.getCurrentWindow().webContents.getPrinters())
    //document.querySelector("#preview").src = 'zoinks.png'
    console.log(path)
  })
}

let pdfDoc = null,
    pageNum = 1,
    pageRendering = false,
    pageNumPending = null,
    scale = 1.5,
    canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d')

let retry = 0
const reloadPDFDocument = async (path) => {
  pdf.GlobalWorkerOptions.workerSrc = '../../../../node_modules/pdfjs-dist/build/pdf.worker.js'


  /**
   * Asynchronously downloads PDF.
   */
  try {
    let pdfDoc_ = await pdf.getDocument(path).promise
    pdfDoc = pdfDoc_
    document.querySelector('#page_count').textContent = pdfDoc.numPages

    if (pageNum >= pdfDoc.numPages) {
      pageNum = pdfDoc.numPages
    }

    // Initial/first page rendering
    renderPage(pageNum)
    pdfdocument = path
  } catch (err) {
    console.error(err)
    // Sometime the PDF loading fails for obscur reason and retrying succeed, hence this code
    if (retry < 3) {
      console.log('retry loading ' + path)
      retry++
      await reloadPDFDocument(path)
    }
  }
}

/**
 * Get page info from document, resize canvas accordingly, and render page.
 * @param num Page number.
 */
function renderPage(num) {
  if (!pdfDoc) return;
  pageRendering = true;
  // Using promise to fetch the page
  pdfDoc.getPage(num).then(function(page) {
    let viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page into canvas context
    let renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };
    let renderTask = page.render(renderContext);

    // Wait for rendering to finish
    renderTask.promise.then(function() {
      pageRendering = false;
      if (pageNumPending !== null) {
        // New page rendering is pending
        renderPage(pageNumPending);
        pageNumPending = null;
      } else {
        document.querySelector('#preview').src = canvas.toDataURL()
        document.querySelector('#paper').style.transform = 'rotate3d(1, 0, 1, ' + ((Math.random() * 4)-2) + 'deg)'
        document.querySelector('#page-navigation').style.display = (pdfDoc.numPages > 1) ? 'flex' : 'none';
        document.querySelector('#preview-pane-content').style.marginTop = (pdfDoc.numPages > 1) ? '-75px' : '0px'
        document.querySelector('#preview-pane').style.justifyContent = (pdfDoc.numPages > 1) ? 'space-between' : 'center';
        displaySpinner(false);
      }
    });
  });

  // Update page counters
  document.querySelector('#page_num').textContent = pageNum;
}

/**
 * If another page rendering in progress, waits until the rendering is
 * finised. Otherwise, executes rendering immediately.
 */
function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
}

/**
 * Displays previous page.
 */
function onPrevPage() {
  if (!pdfDoc) return;
  if (pageNum <= 1) {
    return;
  }
  pageNum--;
  queueRenderPage(pageNum);
}

/**
 * Displays next page.
 */
function onNextPage() {
  if (!pdfDoc) return;
  if (pageNum >= pdfDoc.numPages) {
    return;
  }
  pageNum++;
  queueRenderPage(pageNum);
}

const generatePDF = () => {
  pdfdocument = null
  generateWorksheet()
}

const generateWorksheet = () => {
  displaySpinner(true)
  console.log(paperSize, aspectRatio, rows, cols, spacing, currentScene, storyTips.getTipString(), scriptData)
  setTimeout(()=>{
    worksheetPrinter.generate(paperSize, aspectRatio, rows, cols, spacing, currentScene, storyTips.getTipString(), scriptData)
  }, 500)
}

;(async function () {
  let { projectData } = await ipcRenderer.invoke('exportPDF:getData')
  let { currentBoardData } = projectData

  aspectRatio = currentBoardData.aspectRatio
  currentScene = projectData.currentScene
  scriptData = projectData.scriptData

  document.querySelector('#paper-orientation-row').style.display = 'none'

  updateHTML()
  generateWorksheet()

  loadWindow()
})()

window.ondragover = () => { return false }
window.ondragleave = () => { return false }
window.ondragend = () => { return false }
window.ondrop = () => { return false }
