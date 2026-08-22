; case display-011-tostr
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT 0
  TOSTR
  PRINT
  RET
.end
