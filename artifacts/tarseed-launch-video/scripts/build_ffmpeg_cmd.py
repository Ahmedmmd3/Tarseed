#!/usr/bin/env python3
import os
import sys

def main():
    base_dir = "../public"
    img_dir = f"{base_dir}/images"
    audio = f"{base_dir}/audio/master_soundtrack.mp3"
    
    inputs = []
    def add_input(path, opts=""):
        inputs.append((path, opts))
        return len(inputs) - 1

    audio_idx = add_input(audio)
    
    filters = []
    
    # Scene 0: 2.5s (0.0 to 2.5)
    # Background: #0B1120
    def mk_s0():
        filters.append("color=c=#0B1120:s=1080x1920:d=2.5,setsar=1/1[s0_bg];")
        overlay = add_input(f"{img_dir}/overlays/s0.png", "-loop 1 -t 2.5")
        filters.append(f"[s0_bg][{overlay}:v]overlay=0:0[s0_out];")
        return "s0_out"

    # Scene 1: 7.5s (2.5 to 10.0)
    # Dashboard image scaled up.
    def mk_s1():
        dur = 7.5
        filters.append(f"color=c=#0B1120:s=1080x1920:d={dur},setsar=1/1[s1_bg];")
        img = add_input(f"{img_dir}/glimpses/dashboard.jpg", f"-loop 1 -t {dur}")
        overlay = add_input(f"{img_dir}/overlays/s1.png", f"-loop 1 -t {dur}")
        # Scale image to fit width, rounded corners (simulated by just sizing it)
        filters.append(f"[{img}:v]scale=972:-1,setsar=1/1[img1_scaled];")
        filters.append(f"[s1_bg][img1_scaled]overlay=(W-w)/2:(H-h)/2+100[s1_comp];")
        filters.append(f"[s1_comp][{overlay}:v]overlay=0:0[s1_out];")
        return "s1_out"

    # Scene 2: 2.0s (10.0 to 12.0)
    # Blue background
    def mk_s2():
        dur = 2.0
        filters.append(f"color=c=#2563eb:s=1080x1920:d={dur},setsar=1/1[s2_bg];")
        overlay = add_input(f"{img_dir}/overlays/s2.png", f"-loop 1 -t {dur}")
        filters.append(f"[s2_bg][{overlay}:v]overlay=0:0[s2_out];")
        return "s2_out"

    # Scene 3: 8.0s (12.0 to 20.0)
    # AI Chat and AI Journal stacked
    def mk_s3():
        dur = 8.0
        filters.append(f"color=c=#0B1120:s=1080x1920:d={dur},setsar=1/1[s3_bg];")
        img1 = add_input(f"{img_dir}/glimpses/ai-chat.jpg", f"-loop 1 -t {dur}")
        img2 = add_input(f"{img_dir}/glimpses/ai-journal.jpg", f"-loop 1 -t {dur}")
        overlay = add_input(f"{img_dir}/overlays/s3.png", f"-loop 1 -t {dur}")
        
        # Scale images and position them (simulating the stagger/rotation by hardcoded position)
        filters.append(f"[{img1}:v]scale=850:-1,setsar=1/1[s3_i1];")
        filters.append(f"[{img2}:v]scale=850:-1,setsar=1/1[s3_i2];")
        
        filters.append(f"[s3_bg][s3_i1]overlay=W-w+50:(H-h)/2-150[s3_c1];")
        filters.append(f"[s3_c1][s3_i2]overlay=-50:(H-h)/2+150[s3_c2];")
        filters.append(f"[s3_c2][{overlay}:v]overlay=0:0[s3_out];")
        return "s3_out"
        
    # Scene 4: 4.5s (20.0 to 24.5)
    # Invoice and Reports
    def mk_s4():
        dur = 4.5
        filters.append(f"color=c=#0B1120:s=1080x1920:d={dur},setsar=1/1[s4_bg];")
        img1 = add_input(f"{img_dir}/glimpses/invoice.jpg", f"-loop 1 -t {dur}")
        img2 = add_input(f"{img_dir}/glimpses/reports.jpg", f"-loop 1 -t {dur}")
        overlay = add_input(f"{img_dir}/overlays/s4.png", f"-loop 1 -t {dur}")
        
        filters.append(f"[{img1}:v]scale=900:-1,setsar=1/1[s4_i1];")
        filters.append(f"[{img2}:v]scale=900:-1,setsar=1/1[s4_i2];")
        
        # Display image 1 for first 2.25s, image 2 for second 2.25s
        filters.append(f"[s4_bg][s4_i1]overlay=(W-w)/2:(H-h)/2+150:enable='between(t,0,2.25)'[s4_c1];")
        filters.append(f"[s4_c1][s4_i2]overlay=(W-w)/2:(H-h)/2+150:enable='between(t,2.25,4.5)'[s4_c2];")
        filters.append(f"[s4_c2][{overlay}:v]overlay=0:0[s4_out];")
        return "s4_out"

    # Scene 5: 2.5s (24.5 to 27.0)
    # White bg, logo, cta
    def mk_s5():
        dur = 2.5
        filters.append(f"color=c=white:s=1080x1920:d={dur},setsar=1/1[s5_bg];")
        logo = add_input(f"{img_dir}/tarseed-logo-transparent.png", f"-loop 1 -t {dur}")
        overlay = add_input(f"{img_dir}/overlays/s5.png", f"-loop 1 -t {dur}")
        
        filters.append(f"[{logo}:v]scale=700:-1,setsar=1/1[s5_logo];")
        filters.append(f"[s5_bg][s5_logo]overlay=(W-w)/2:(H-h)/2-150[s5_c1];")
        filters.append(f"[s5_c1][{overlay}:v]overlay=0:0[s5_out];")
        return "s5_out"

    s0 = mk_s0()
    s1 = mk_s1()
    s2 = mk_s2()
    s3 = mk_s3()
    s4 = mk_s4()
    s5 = mk_s5()
    
    filters.append(f"[{s0}]format=yuv420p,setsar=1/1[s0_f];")
    filters.append(f"[{s1}]format=yuv420p,setsar=1/1[s1_f];")
    filters.append(f"[{s2}]format=yuv420p,setsar=1/1[s2_f];")
    filters.append(f"[{s3}]format=yuv420p,setsar=1/1[s3_f];")
    filters.append(f"[{s4}]format=yuv420p,setsar=1/1[s4_f];")
    filters.append(f"[{s5}]format=yuv420p,setsar=1/1[s5_f];")
    
    filters.append(f"[s0_f][s1_f][s2_f][s3_f][s4_f][s5_f]concat=n=6:v=1:a=0:unsafe=1[vout]")
    
    cmd = ["ffmpeg", "-y", "-v", "warning"]
    for path, opts in inputs:
        if opts:
            cmd.extend(opts.split())
        cmd.extend(["-i", path])
        
    cmd.extend([
        "-filter_complex", "".join(filters),
        "-map", "[vout]",
        "-map", f"{audio_idx}:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-r", "60",
        "-t", "27.0",
        "-movflags", "+faststart",
        "../exports/tarseed-launch-final.mp4"
    ])
    
    with open("render-final-offline.sh", "w") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write("set -e\n")
        f.write("mkdir -p ../exports\n")
        f.write(" ".join(f'"{c}"' if " " in c or "[" in c or "=" in c else c for c in cmd) + "\n")
        
    os.chmod("render-final-offline.sh", 0o755)
    print("Generated render-final-offline.sh")

if __name__ == "__main__":
    main()