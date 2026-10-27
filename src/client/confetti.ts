export function celebrate(size: "chapter" | "lesson") {
  document.querySelector(".confetti")?.remove();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.dataset.celebration = size;
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const large = size === "lesson";
  const colors = ["#f5c542", "#ff817c", "#81c7ff", "#a5e4b0", "#c4a5ff"];
  const animations: Promise<unknown>[] = [];
  for (let i = 0; i < (large ? 150 : 36); i++) {
    const piece = document.createElement("span");
    piece.style.background = colors[i % colors.length];
    piece.style.left = `${large ? Math.random() * 100 : 35 + Math.random() * 30}%`;
    piece.style.borderRadius = i % 3 === 0 ? "50%" : "1px";
    layer.append(piece);
    const drift = (Math.random() - 0.5) * (large ? 400 : 180);
    const rotation = (Math.random() - 0.5) * 1080;
    const animation = piece.animate(
      [
        { transform: "translate(0, -20px) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${drift}px, ${large ? "105vh" : "42vh"}) rotate(${rotation}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: (large ? 2300 : 1000) + Math.random() * 700,
        delay: Math.random() * (large ? 650 : 180),
        easing: "cubic-bezier(.2,.5,.5,1)",
        fill: "both",
      },
    );
    animations.push(animation.finished.catch(() => {}));
  }
  void Promise.all(animations).then(() => layer.remove());
}
