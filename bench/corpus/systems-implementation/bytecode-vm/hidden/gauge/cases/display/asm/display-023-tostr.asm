; case display-023-tostr
; expect exit=0 stdout="plain\n"
.func main arity=0 locals=0
  PUSH_STR "plain"
  TOSTR
  PRINT
  RET
.end
