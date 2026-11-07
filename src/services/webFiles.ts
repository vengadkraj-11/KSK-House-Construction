export function downloadBase64File(
  base64: string,
  filename: string,
  mimeType: string
): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  try {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function printHtmlInBrowser(html: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  try {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return false;

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    return true;
  } catch {
    return false;
  }
}

export function openBrowserPrintWindow(): Window | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  try {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return null;
    printWindow.document.title = 'Preparing PDF';
    printWindow.document.body.textContent = 'Preparing PDF…';
    return printWindow;
  } catch {
    return null;
  }
}

export function printHtmlInWindow(html: string, title: string, printWindow: Window): boolean {
  if (typeof window === 'undefined' || printWindow.closed) return false;

  try {
    let started = false;
    printWindow.onload = () => {
      if (started || printWindow.closed) return;
      started = true;
      printWindow.focus();
      printWindow.print();
    };
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = title;
    return true;
  } catch {
    return false;
  }
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string
): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  try {
    const blob = new Blob([content], {
      type: `${mimeType};charset=utf-8`
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
