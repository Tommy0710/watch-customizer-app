// src/utils/cropImage.ts

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

export function getRadianAngle(degreeValue: number) {
  return (degreeValue * Math.PI) / 180;
}

export default async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0
): Promise<string> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context');
  }

  // Tính toán vùng an toàn để khi xoay ảnh không bị mất góc
  const safeArea = Math.max(image.width, image.height) * 2;
  canvas.width = safeArea;
  canvas.height = safeArea;

  // Dịch chuyển tâm Canvas và xoay ảnh
  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate(getRadianAngle(rotation));
  ctx.translate(-safeArea / 2, -safeArea / 2);

  // Vẽ ảnh gốc lên Canvas đã xoay
  ctx.drawImage(
    image,
    safeArea / 2 - image.width / 2,
    safeArea / 2 - image.height / 2
  );

  // Trích xuất vùng ảnh (pixels) theo tọa độ mà khách đã kéo/zoom
  const data = ctx.getImageData(
    safeArea / 2 - image.width / 2 + pixelCrop.x,
    safeArea / 2 - image.height / 2 + pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height
  );

  // Thiết lập lại Canvas với kích thước chuẩn xác cần cắt
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  // Dán phần ảnh vừa trích xuất vào
  ctx.putImageData(data, 0, 0);

  // UI hiển thị khung crop hình tròn (cropShape="round"), nhưng pixelCrop ở trên luôn là hình
  // vuông bao quanh — 4 góc vuông ngoài vòng tròn hiển thị vẫn chứa pixel nền thật (không phải
  // mặt đồng hồ) dù khách không nhìn thấy chúng trên UI. Che các góc đó bằng nền trắng sạch để
  // ảnh thật sự gửi đi khớp với đúng những gì khách thấy trong khung tròn, giống định dạng nền
  // trắng đã dùng nhất quán ở /api/generate cho ảnh mặt đồng hồ tham chiếu.
  const radius = Math.min(canvas.width, canvas.height) / 2;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  // Trả về bức ảnh đã cắt gọn gàng dưới dạng Base64 (PNG để giữ chất lượng cao nhất)
  return canvas.toDataURL('image/png');
}