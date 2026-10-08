# Hướng dẫn thử tay: nghe và dịch âm thanh màn hình (Google Meet, Discord)

Tài liệu này dùng để tự kiểm tra tính năng "Thu âm thanh màn hình" trên bản chạy thật. Trình duyệt cần là **Chrome hoặc Edge trên máy tính**. Điện thoại và Safari không chia sẻ được âm thanh tab/màn hình.

## Chuẩn bị

1. Đeo **tai nghe** (rất quan trọng, nếu không micro sẽ thu lại tiếng loa và chữ bị lặp).
2. Mở sẵn cuộc họp Google Meet hoặc kênh thoại Discord ở một tab khác (hoặc mở một video YouTube có tiếng nói để thử nhanh).
3. Vào `Thêm mới` → `Ghi âm trực tiếp`.

## Ca 1: Chỉ âm thanh tab (Meet/YouTube)

1. Chọn nguồn âm thanh **Âm thanh tab / màn hình**.
2. Chọn cặp ngôn ngữ và engine (Soniox hoặc Gemini).
3. Bấm bắt đầu, đồng ý hộp thoại xác nhận, rồi trong cửa sổ chia sẻ của trình duyệt chọn **thẻ Chrome (Chrome Tab)** chứa cuộc họp và **bật "Chia sẻ âm thanh tab"**.
4. Mong đợi: thanh mức âm của màn hình nhảy khi có người nói, chữ gốc và bản dịch hiện ra.
5. Nếu bạn không bật chia sẻ âm thanh, ứng dụng báo "không có âm thanh" và không bắt đầu ghi.

## Ca 2: Micro + âm thanh màn hình (gán nhãn Tôi / Cuộc họp)

1. Chọn nguồn **Micro + màn hình**, bật diarization (Số người nói ≥ 2) nếu muốn tách người trong cuộc họp.
2. Nói vài câu bằng micro, rồi để người khác trong cuộc họp nói.
3. Mong đợi: câu bạn nói được gán **Tôi**, câu từ cuộc họp được gán **Cuộc họp** (hoặc Speaker N nếu engine tách được người). Nhãn chỉ gắn khi câu đã chốt; câu nào hai bên nói chồng nhau (không bên nào chiếm ≥ 65%) giữ nhãn mặc định, bạn sửa tay được bằng danh sách chọn người nói.
4. Nếu nhãn sai nhiều: kiểm tra có đeo tai nghe không và âm lượng micro/cuộc họp có chênh lệch quá lớn không.

## Ca 3: Dừng chia sẻ giữa chừng

1. Trong lúc đang ghi, bấm "Dừng chia sẻ" ở thanh của trình duyệt.
2. Mong đợi: phiên **không kết thúc**, hiện thông báo "Đã dừng chia sẻ…" kèm nút **Chia sẻ lại**. Chỉ có âm thanh màn hình: việc dịch tạm dừng, buổi ghi vẫn giữ. Micro + màn hình: micro vẫn ghi.
3. Bấm chia sẻ lại và chọn tab: bản dịch tiếp tục.

## Ca 4: Tắt/mở tab, đổi tab

- Đóng tab được chia sẻ: tương đương ca 3.
- Đổi sang tab khác: âm thanh tab đã chia sẻ vẫn được thu (không cần giữ tab ở phía trước).

## Cần ghi lại khi báo kết quả

- Trình duyệt và phiên bản, hệ điều hành.
- Ca nào lỗi, thông báo lỗi nguyên văn, ảnh chụp màn hình nếu có.
- Có bị vọng tiếng/lặp chữ không, khi dùng tai nghe hay loa ngoài.
- Với mỗi engine (Soniox, Gemini): chữ gốc và bản dịch có hiện không, "Chốt câu: …ms" trong phần chẩn đoán (nút thông tin ở thanh ghi) là bao nhiêu.

## Giới hạn đã biết

- Chỉ Chrome/Edge trên máy tính; Firefox và Safari không chia sẻ được âm thanh.
- Chia sẻ **cả màn hình** trên macOS không kèm âm thanh hệ thống; hãy chia sẻ **thẻ trình duyệt**.
- Cuộc họp trong ứng dụng desktop (Discord app, Zoom app) chỉ thu được qua chia sẻ cửa sổ/màn hình trên Windows; nếu không có âm thanh, mở bản web của Discord/Meet trong Chrome.
