; case display-026-tostr
; expect exit=0 stdout="\n"
.func main arity=0 locals=0
  PUSH_STR ""
  TOSTR
  PRINT
  RET
.end
