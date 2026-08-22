; case display-008-tostr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_FALSE
  TOSTR
  PRINT
  RET
.end
