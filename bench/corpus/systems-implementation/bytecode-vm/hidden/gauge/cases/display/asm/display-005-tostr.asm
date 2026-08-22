; case display-005-tostr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_TRUE
  TOSTR
  PRINT
  RET
.end
