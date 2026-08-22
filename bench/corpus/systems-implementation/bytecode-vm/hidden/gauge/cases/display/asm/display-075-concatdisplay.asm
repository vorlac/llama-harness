; case display-075-concatdisplay
; expect exit=0 stdout="n=42\n"
.func main arity=0 locals=0
  PUSH_STR "n="
  PUSH_INT 42
  TOSTR
  CONCAT
  PRINT
  RET
.end
