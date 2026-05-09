const IMAGE_FOLDER = "imagenes";
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const MAX_SLIDES = 200;

const state = {
  slides: [],
  currentIndex: 0,
  touchStartX: 0,
  actionRunning: false,
  fullscreenLocked: false
};

const dom = {
  presentationShell: document.getElementById("presentationShell"),
  stageFrame: document.getElementById("stageFrame"),
  slideImage: document.getElementById("slideImage"),
  slideFilename: document.getElementById("slideFilename"),
  slideHint: document.getElementById("slideHint"),
  slideCounter: document.getElementById("slideCounter"),
  statusBadge: document.getElementById("statusBadge"),
  progressFill: document.getElementById("progressFill"),
  loadingLayer: document.getElementById("loadingLayer"),
  emptyLayer: document.getElementById("emptyLayer"),
  thumbStrip: document.getElementById("thumbStrip"),
  feedbackLine: document.getElementById("feedbackLine"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  prevStageBtn: document.getElementById("prevStageBtn"),
  nextStageBtn: document.getElementById("nextStageBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  downloadZipBtn: document.getElementById("downloadZipBtn"),
  reloadBtn: document.getElementById("reloadBtn")
};

const encoder = new TextEncoder();
const crcTable = createCrcTable();

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  initializePresentation();
});

function bindEvents() {
  dom.prevBtn.addEventListener("click", () => changeSlide(-1));
  dom.nextBtn.addEventListener("click", () => changeSlide(1));
  dom.prevStageBtn.addEventListener("click", () => changeSlide(-1));
  dom.nextStageBtn.addEventListener("click", () => changeSlide(1));
  dom.reloadBtn.addEventListener("click", () => initializePresentation());
  dom.fullscreenBtn.addEventListener("click", toggleFullscreen);
  dom.downloadPdfBtn.addEventListener("click", downloadPdf);
  dom.downloadZipBtn.addEventListener("click", downloadZip);

  dom.stageFrame.addEventListener(
    "touchstart",
    (event) => {
      state.touchStartX = event.changedTouches[0].clientX;
    },
    { passive: true }
  );

  dom.stageFrame.addEventListener(
    "touchend",
    (event) => {
      const delta = event.changedTouches[0].clientX - state.touchStartX;

      if (Math.abs(delta) < 45) {
        return;
      }

      changeSlide(delta > 0 ? -1 : 1);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      changeSlide(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      changeSlide(1);
    }

    if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });

  document.addEventListener("fullscreenchange", syncFullscreenState);
}

async function initializePresentation() {
  state.slides = [];
  state.currentIndex = 0;

  setLoading(true);
  setFeedback("Buscando imagenes numeradas en la carpeta imagenes...");
  setStatus("Buscando imagenes...");
  resetThumbs();

  try {
    const slides = await discoverSlides();
    state.slides = slides;

    if (!slides.length) {
      showEmptyState();
      setFeedback(
        "No encontre archivos numerados en imagenes/. Agrega 1.png, 2.png, 3.png... y presiona Recargar.",
        "danger"
      );
      setStatus("Sin imagenes");
      return;
    }

    buildThumbnails(slides);
    goToSlide(0);
    setFeedback(
      `Se cargaron ${slides.length} diapositivas desde la carpeta imagenes.`
    );
    setStatus("Presentacion lista");
  } catch (error) {
    console.error(error);
    showEmptyState();
    setFeedback(
      "Ocurrio un problema al leer las imagenes. Revisa la carpeta y vuelve a intentarlo.",
      "danger"
    );
    setStatus("Error de lectura");
  } finally {
    setLoading(false);
  }
}

async function discoverSlides() {
  const slides = [];

  for (let index = 1; index <= MAX_SLIDES; index += 1) {
    const match = await findSlideSource(index);

    if (!match) {
      break;
    }

    slides.push({
      index,
      filename: `${index}.${match.extension}`,
      src: match.src,
      extension: match.extension
    });
  }

  return slides;
}

async function findSlideSource(index) {
  for (const extension of IMAGE_EXTENSIONS) {
    const src = `${IMAGE_FOLDER}/${index}.${extension}`;
    const exists = await canLoadImage(src);

    if (exists) {
      return { src, extension };
    }
  }

  return null;
}

function canLoadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;

    window.setTimeout(() => finish(false), 3200);
  });
}

function showEmptyState() {
  setLayerVisibility(dom.slideImage, false, "block");
  setLayerVisibility(dom.loadingLayer, false);
  setLayerVisibility(dom.emptyLayer, true);
  dom.slideFilename.textContent = "Sin diapositivas";
  dom.slideHint.textContent = "Agrega imagenes consecutivas en imagenes/";
  dom.slideCounter.textContent = "0 / 0";
  dom.progressFill.style.width = "0%";
  updateNavigation();
}

function goToSlide(index) {
  if (!state.slides.length) {
    showEmptyState();
    return;
  }

  const safeIndex = Math.max(0, Math.min(index, state.slides.length - 1));
  const slide = state.slides[safeIndex];

  state.currentIndex = safeIndex;

  dom.slideImage.src = slide.src;
  dom.slideImage.alt = `Diapositiva ${slide.index}`;
  setLayerVisibility(dom.slideImage, true, "block");
  setLayerVisibility(dom.emptyLayer, false);
  dom.slideFilename.textContent = slide.filename;
  dom.slideHint.textContent = `Carpeta ${IMAGE_FOLDER}/ - pantalla completa con la tecla F`;
  dom.slideCounter.textContent = `${safeIndex + 1} / ${state.slides.length}`;
  dom.progressFill.style.width = `${((safeIndex + 1) / state.slides.length) * 100}%`;

  highlightThumbnail(safeIndex);
  preloadNeighbor(safeIndex + 1);
  preloadNeighbor(safeIndex - 1);
  updateNavigation();
}

function changeSlide(direction) {
  if (!state.slides.length) {
    return;
  }

  const nextIndex = state.currentIndex + direction;

  if (nextIndex < 0 || nextIndex >= state.slides.length) {
    return;
  }

  goToSlide(nextIndex);
}

function preloadNeighbor(index) {
  const slide = state.slides[index];

  if (!slide) {
    return;
  }

  const image = new Image();
  image.src = slide.src;
}

function updateNavigation() {
  const hasSlides = state.slides.length > 0;
  const isFirst = state.currentIndex === 0;
  const isLast = state.currentIndex === state.slides.length - 1;

  dom.prevBtn.disabled = !hasSlides || isFirst || state.actionRunning;
  dom.nextBtn.disabled = !hasSlides || isLast || state.actionRunning;
  dom.prevStageBtn.disabled = !hasSlides || isFirst || state.actionRunning;
  dom.nextStageBtn.disabled = !hasSlides || isLast || state.actionRunning;
  dom.fullscreenBtn.disabled = !hasSlides;
  dom.downloadPdfBtn.disabled = !hasSlides || state.actionRunning;
  dom.downloadZipBtn.disabled = !hasSlides || state.actionRunning;
}

function buildThumbnails(slides) {
  const fragment = document.createDocumentFragment();

  slides.forEach((slide, index) => {
    const button = document.createElement("button");
    button.className = "thumb-button";
    button.type = "button";
    button.dataset.index = String(index);
    button.setAttribute("aria-label", `Abrir diapositiva ${slide.index}`);

    const image = document.createElement("img");
    image.src = slide.src;
    image.alt = `Miniatura ${slide.index}`;
    image.loading = "lazy";

    const text = document.createElement("div");
    text.className = "thumb-text";
    text.innerHTML = `<strong>Diapositiva ${slide.index}</strong><span>${slide.filename}</span>`;

    button.append(image, text);
    button.addEventListener("click", () => goToSlide(index));
    fragment.append(button);
  });

  dom.thumbStrip.replaceChildren(fragment);
}

function resetThumbs() {
  dom.thumbStrip.replaceChildren();
}

function highlightThumbnail(index) {
  const buttons = dom.thumbStrip.querySelectorAll(".thumb-button");

  buttons.forEach((button) => {
    const isActive = Number(button.dataset.index) === index;
    button.classList.toggle("is-active", isActive);

    if (isActive) {
      button.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    }
  });
}

function setLoading(isLoading) {
  setLayerVisibility(dom.loadingLayer, isLoading);

  if (isLoading) {
    setLayerVisibility(dom.slideImage, false, "block");
    setLayerVisibility(dom.emptyLayer, false);
  }
}

function setStatus(message) {
  dom.statusBadge.textContent = message;
}

function setFeedback(message, tone = "neutral") {
  dom.feedbackLine.textContent = message;
  dom.feedbackLine.classList.remove("is-success", "is-danger");

  if (tone === "success") {
    dom.feedbackLine.classList.add("is-success");
  }

  if (tone === "danger") {
    dom.feedbackLine.classList.add("is-danger");
  }
}

function setLayerVisibility(element, visible, displayValue = "grid") {
  element.hidden = !visible;
  element.style.display = visible ? displayValue : "none";
}

async function toggleFullscreen() {
  if (!state.slides.length) {
    return;
  }

  const activeFullscreenElement = document.fullscreenElement;

  if (activeFullscreenElement === dom.presentationShell) {
    await document.exitFullscreen();
    return;
  }

  if (!dom.presentationShell.requestFullscreen) {
    setFeedback("Tu navegador no soporta pantalla completa para este elemento.", "danger");
    return;
  }

  await dom.presentationShell.requestFullscreen();

  if (window.innerWidth <= 900) {
    await tryLockLandscape();
  }
}

function syncFullscreenState() {
  const isFullscreen = document.fullscreenElement === dom.presentationShell;
  dom.presentationShell.classList.toggle("is-fullscreen", isFullscreen);
  dom.fullscreenBtn.textContent = isFullscreen ? "Salir de pantalla completa" : "Pantalla completa";
  dom.slideHint.textContent = isFullscreen
    ? "Vista inmersiva activa"
    : `Carpeta ${IMAGE_FOLDER}/ - pantalla completa con la tecla F`;

  if (!isFullscreen) {
    tryUnlockOrientation();
  }
}

async function tryLockLandscape() {
  if (!screen.orientation || !screen.orientation.lock) {
    return;
  }

  try {
    await screen.orientation.lock("landscape");
    state.fullscreenLocked = true;
  } catch (error) {
    state.fullscreenLocked = false;
  }
}

function tryUnlockOrientation() {
  if (!state.fullscreenLocked || !screen.orientation || !screen.orientation.unlock) {
    return;
  }

  screen.orientation.unlock();
  state.fullscreenLocked = false;
}

async function downloadPdf() {
  if (!state.slides.length || state.actionRunning) {
    return;
  }

  await runAction("Generando PDF...", async () => {
    const pages = [];

    for (let index = 0; index < state.slides.length; index += 1) {
      const slide = state.slides[index];
      setFeedback(
        `Preparando PDF: diapositiva ${index + 1} de ${state.slides.length}...`
      );

      const image = await loadImageElement(slide.src);
      const jpegBlob = await imageToBlob(image, "image/jpeg", 0.92, "#ffffff");
      const bytes = new Uint8Array(await jpegBlob.arrayBuffer());

      pages.push({
        width: image.naturalWidth,
        height: image.naturalHeight,
        bytes
      });
    }

    const pdfBlob = buildPdfBlob(pages);
    triggerDownload(pdfBlob, "presentacion.pdf");
    setFeedback("PDF generado correctamente.", "success");
  });
}

async function downloadZip() {
  if (!state.slides.length || state.actionRunning) {
    return;
  }

  await runAction("Generando ZIP...", async () => {
    const files = [];

    for (let index = 0; index < state.slides.length; index += 1) {
      const slide = state.slides[index];
      setFeedback(
        `Preparando ZIP: imagen ${index + 1} de ${state.slides.length}...`
      );

      const image = await loadImageElement(slide.src);
      const blob = await imageToBlob(image, "image/png", 0.95, "#050b11");
      const bytes = new Uint8Array(await blob.arrayBuffer());

      files.push({
        name: `${slide.index}.png`,
        bytes
      });
    }

    const zipBlob = buildZipBlob(files);
    triggerDownload(zipBlob, "imagenes-presentacion.zip");
    setFeedback("ZIP generado correctamente.", "success");
  });
}

async function runAction(statusMessage, callback) {
  state.actionRunning = true;
  setStatus(statusMessage);
  updateNavigation();

  try {
    await callback();
    setStatus("Presentacion lista");
  } catch (error) {
    console.error(error);
    setStatus("Error");
    setFeedback(
      "No se pudo completar la descarga. Revisa que las imagenes existan y vuelve a intentarlo.",
      "danger"
    );
  } finally {
    state.actionRunning = false;
    updateNavigation();
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    image.src = src;
  });
}

function imageToBlob(image, mimeType, quality, fillStyle) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  context.fillStyle = fillStyle;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No fue posible convertir la imagen."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function buildPdfBlob(pages) {
  if (!pages.length) {
    throw new Error("No hay paginas para el PDF.");
  }

  let objectNumber = 3;
  const pageDefinitions = pages.map((page, index) => {
    const pageObject = objectNumber;
    const contentObject = objectNumber + 1;
    const imageObject = objectNumber + 2;
    objectNumber += 3;

    const pageWidth = Math.max(10, page.width * 0.75);
    const pageHeight = Math.max(10, page.height * 0.75);
    const imageName = `Im${index + 1}`;
    const contentStream = `${pageWidth} 0 0 ${pageHeight} 0 0 cm /${imageName} Do`;
    const contentBytes = encoder.encode(contentStream);

    return {
      pageObject,
      contentObject,
      imageObject,
      pageWidth,
      pageHeight,
      imageName,
      contentBytes,
      imageBytes: page.bytes,
      imageWidth: page.width,
      imageHeight: page.height
    };
  });

  const objectCount = objectNumber - 1;
  const objects = new Array(objectCount + 1);
  const pageRefs = pageDefinitions.map((definition) => `${definition.pageObject} 0 R`).join(" ");

  objects[1] = [ascii("<< /Type /Catalog /Pages 2 0 R >>")];
  objects[2] = [ascii(`<< /Type /Pages /Count ${pageDefinitions.length} /Kids [${pageRefs}] >>`)];

  pageDefinitions.forEach((definition) => {
    objects[definition.pageObject] = [
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${definition.pageWidth} ${definition.pageHeight}] /Resources << /XObject << /${definition.imageName} ${definition.imageObject} 0 R >> >> /Contents ${definition.contentObject} 0 R >>`
      )
    ];

    objects[definition.contentObject] = [
      ascii(`<< /Length ${definition.contentBytes.length} >>`),
      ascii("\nstream\n"),
      definition.contentBytes,
      ascii("\nendstream")
    ];

    objects[definition.imageObject] = [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${definition.imageWidth} /Height ${definition.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${definition.imageBytes.length} >>`
      ),
      ascii("\nstream\n"),
      definition.imageBytes,
      ascii("\nendstream")
    ];
  });

  const chunks = [];
  const offsets = new Array(objectCount + 1).fill(0);
  let currentOffset = 0;

  const pushChunk = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : ascii(chunk);
    chunks.push(bytes);
    currentOffset += bytes.length;
  };

  const header = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 51, 10, 37, 255, 255, 255, 255, 10]);
  pushChunk(header);

  for (let index = 1; index <= objectCount; index += 1) {
    offsets[index] = currentOffset;
    pushChunk(`${index} 0 obj\n`);

    const parts = objects[index];
    parts.forEach(pushChunk);

    pushChunk("\nendobj\n");
  }

  const xrefOffset = currentOffset;
  pushChunk(`xref\n0 ${objectCount + 1}\n`);
  pushChunk("0000000000 65535 f \n");

  for (let index = 1; index <= objectCount; index += 1) {
    pushChunk(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }

  pushChunk(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`);
  pushChunk(`startxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}

function buildZipBlob(files) {
  if (!files.length) {
    throw new Error("No hay archivos para el ZIP.");
  }

  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const dosDate = getDosDateParts(new Date());

  files.forEach((file) => {
    const nameBytes = ascii(file.name);
    const crc = crc32(file.bytes);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(dosDate.time),
      u16(dosDate.date),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ]);

    const localOffset = offset;
    chunks.push(localHeader, file.bytes);
    offset += localHeader.length + file.bytes.length;

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(dosDate.time),
      u16(dosDate.date),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      nameBytes
    ]);

    centralDirectory.push(centralHeader);
  });

  const centralOffset = offset;
  let centralLength = 0;

  centralDirectory.forEach((entry) => {
    chunks.push(entry);
    offset += entry.length;
    centralLength += entry.length;
  });

  const endRecord = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralLength),
    u32(centralOffset),
    u16(0)
  ]);

  chunks.push(endRecord);
  return new Blob(chunks, { type: "application/zip" });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getDosDateParts(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 31) << 11) |
    ((date.getMinutes() & 63) << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((year - 1980) & 127) << 9) |
    (((date.getMonth() + 1) & 15) << 5) |
    (date.getDate() & 31);

  return { time: dosTime, date: dosDate };
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }

    table[index] = crc >>> 0;
  }

  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    const lookup = (crc ^ bytes[index]) & 255;
    crc = (crc >>> 8) ^ crcTable[lookup];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function ascii(text) {
  return encoder.encode(text);
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}
